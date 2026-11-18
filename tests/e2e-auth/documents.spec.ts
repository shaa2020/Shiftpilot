/**
 * Document requests end to end: the agency requests a document, the worker
 * sees it (phone), uploads it, the agency opens the document page, previews,
 * rejects, the worker re-uploads, the agency verifies; bulk "everyone
 * missing it" requests; renewal; document types; worker profile tab.
 */
import { devices, expect, test, type Page } from "@playwright/test";
import { confirmAction, expectNoError, signIn, unique, USERS } from "./helpers";

test.describe.configure({ mode: "serial" });
const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF") });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const title = unique("Bank statement");
let docUrl = "";

async function toast(page: Page, re: RegExp) {
  await expect(page.locator("[data-sonner-toast]", { hasText: re }).first()).toBeVisible({ timeout: 20_000 });
}

test("agency requests a described document from a chosen worker", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/documents?tab=requests");
  await expect(page.getByRole("heading", { name: "Request a document" })).toBeVisible();
  await page.locator("#rq-title").fill(title);
  await page.locator("#rq-message").fill("Needed to set up your wage payments. Please show your name and IBAN.");
  await page.getByLabel("Search workers").fill("Mohamed");
  await page.getByRole("list", { name: "Workers" }).getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Send request" }).click();
  await toast(page, /Requested from 1 worker/);
  await page.reload();
  await expect(page.getByText(title)).toBeVisible();
  await expectNoError(page);
});

test("worker sees the request on a phone and uploads it", async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  await signIn(page, USERS.worker);
  await page.goto("/worker");
  await expect(page.getByText(/document(s)? requested/)).toBeVisible();
  await page.goto("/worker/documents");
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Requested by your agency" }) });
  const card = section.locator("div.border-l-4", { hasText: title });
  await expect(card).toBeVisible();
  await expect(card.getByText("Needed to set up your wage payments")).toBeVisible();
  await card.locator('[name="file"]').setInputFiles({ name: "statement.png", mimeType: "image/png", buffer: PNG });
  await card.getByRole("button", { name: "Upload" }).click();
  await toast(page, /Uploaded/);
  await page.reload();
  await expect(section.locator("div.border-l-4", { hasText: title }).getByText("Uploaded — being checked")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await ctx.close();
});

test("agency reviews on the document page: preview, history, reject", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/documents?tab=requests&filter=submitted");
  const row = page.locator("li", { hasText: title });
  await row.getByRole("link", { name: "Review upload" }).click();
  await page.waitForURL(/\/admin\/documents\/[0-9a-f-]{36}$/);
  docUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const preview = page.getByRole("img", { name: `Preview of ${title}` });
  await expect(preview).toBeVisible();
  expect(await preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
  await expect(page.getByText("v1").first()).toBeVisible();
  await confirmAction(page, page.getByRole("button", { name: "Reject…" }), { reason: "The IBAN is not readable." });
  await page.reload();
  await expect(page.getByText("The IBAN is not readable.").first()).toBeVisible();
});

test("worker re-uploads after the rejection; agency verifies and the request completes", async ({ page }) => {
  await signIn(page, USERS.worker);
  await page.goto("/worker/documents");
  const card = page.locator("div.border-l-4", { hasText: title });
  await expect(card.getByText("The IBAN is not readable.")).toBeVisible();
  await card.locator('[name="file"]').setInputFiles(pdf("statement-v2.pdf"));
  await card.getByRole("button", { name: "Upload" }).click();
  await toast(page, /Uploaded/);

  await signIn(page, USERS.owner);
  await page.goto(docUrl);
  await expect(page.getByText("v2").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /statement-v2\.pdf/ })).toBeVisible();
  await page.getByRole("button", { name: "Verify document" }).click();
  await toast(page, /verified/i);
  await page.goto("/admin/documents?tab=requests&filter=completed");
  await expect(page.getByText(title)).toBeVisible();

  await signIn(page, USERS.worker);
  await page.goto("/worker/documents");
  await page.getByText(/Completed requests/).click();
  await expect(page.getByText(title)).toBeVisible();
});

test("bulk request to everyone missing a type, reminders and cancel", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/documents?tab=requests");
  await page.locator("#rq-type").selectOption({ label: "Certificate" });
  await page.getByRole("button", { name: "Everyone missing it" }).click();
  await page.locator("#rq-message").fill("Please upload your VCA certificate.");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toContainText(/Requested from \d+ worker|already/);
  await page.reload();
  const first = page.locator("li", { hasText: "Certificate" }).filter({ has: page.getByRole("button", { name: "Remind" }) }).first();
  if (await first.count()) {
    await confirmAction(page, first.getByRole("button", { name: "Remind" }), { expectToast: /Reminder sent/ });
    await page.reload();
    await confirmAction(page, page.locator("li", { hasText: "Certificate" }).getByRole("button", { name: "Cancel" }).first(), { expectToast: /cancelled/i });
  }
});

test("document types, library, expiring and the worker profile tab", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/documents?tab=types");
  const typeName = unique("Food hygiene certificate");
  await page.locator('[name="name"]').fill(typeName);
  await page.locator('[name="required_employee"]').check();
  await page.locator('[name="requires_expiry"]').check();
  await page.getByRole("button", { name: "Add type" }).click();
  await toast(page, /Document type added/);
  await page.reload();
  await expect(page.getByText(typeName)).toBeVisible();

  await page.goto("/admin/documents?tab=library");
  await page.locator('[name="q"]').fill(title.split(" ")[0]!);
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByText(title).first()).toBeVisible();
  await page.goto("/admin/documents?tab=expiring");
  await expectNoError(page);

  await page.goto("/admin/workers");
  await page.getByRole("link", { name: /Mohamed/ }).first().click();
  await page.waitForURL(/\/admin\/workers\/[0-9a-f-]{36}/);
  await page.goto(new URL(page.url()).pathname + "?tab=documents");
  await expect(page.getByText(/of \d+ verified/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Checklist" })).toBeVisible();
  await expect(page.locator("li p", { hasText: typeName }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Request a document" })).toBeVisible();
  await expectNoError(page);
});
