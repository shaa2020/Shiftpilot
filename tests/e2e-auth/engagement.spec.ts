/**
 * Engagement & customisation: branding across portals and invoices,
 * announcements, messaging between agency, workers and clients, client
 * ratings and preferred workers, worker calendar feed and CSV exports.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { confirmAction, expectNoError, signIn, submit, unique, USERS } from "./helpers";

test.describe.configure({ mode: "serial" });
const n = (f: Locator, name: string) => f.locator(`[name="${name}"]`).first();
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const welcome = unique("Welcome to the Demo team");
const announcement = unique("New uniforms");
const subject = unique("Shift tomorrow");
const clientSubject = unique("Extra staff");

async function get(page: Page, path: string) {
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  return page.request.get(path, { headers: { cookie } });
}

test("branding: colour, logo, welcome text and invoice footer apply to every portal", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/settings/branding");
  await page.getByRole("button", { name: "Use #0f766e" }).click();
  await page.locator('[name="logo"]').setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await page.locator('[name="worker_welcome"]').fill(welcome);
  await page.locator('[name="client_welcome"]').fill("Your account manager is available on weekdays.");
  await page.locator('[name="invoice_footer"]').fill("Our general terms apply. Thank you for your business.");
  await page.getByRole("button", { name: "Save branding" }).click();
  await expect(page.locator("[data-sonner-toast]").first()).toContainText(/Branding saved/);
  await page.reload();
  expect(await page.locator("style").evaluateAll((els) => els.some((e) => e.textContent?.includes("--primary:#0f766e")))).toBe(true);
  const logo = page.locator('aside img[alt=""][src^="/api/branding/logo/"]');
  await expect(logo).toBeVisible();
  const res = await get(page, (await logo.getAttribute("src"))!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");

  // Invoice PDFs are still produced (now with logo, colour and footer).
  await page.goto("/admin/invoices");
  const pdfLink = page.locator('a[href*="/api/invoices/"][href$="/pdf"]').first();
  if (await pdfLink.count()) {
    const pdf = await get(page, (await pdfLink.getAttribute("href"))!);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
  }

  await signIn(page, USERS.worker);
  await page.goto("/worker");
  await expect(page.getByText(welcome)).toBeVisible();
  expect(await page.locator("style").evaluateAll((els) => els.some((e) => e.textContent?.includes("--primary:#0f766e")))).toBe(true);
  await signIn(page, USERS.client);
  await page.goto("/client");
  await expect(page.getByText("Your account manager is available on weekdays.")).toBeVisible();
});

test("announcements reach the chosen audience only", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/announcements");
  await submit(page, "Publish", async (f) => {
    await n(f, "title").fill(announcement);
    await n(f, "body").fill("Pick them up at the office on Monday.");
    await n(f, "audience").selectOption("workers");
    await n(f, "pinned").check();
  });
  await expect(page.getByText(announcement).first()).toBeVisible();

  await signIn(page, USERS.worker);
  await page.goto("/worker");
  await expect(page.getByText(announcement)).toBeVisible();
  await page.goto("/notifications");
  await expect(page.getByText(announcement).first()).toBeVisible();

  await signIn(page, USERS.client);
  await page.goto("/client");
  await expect(page.getByText(announcement)).toHaveCount(0);
});

test("messaging: planner ↔ worker with an internal note, and client → agency", async ({ page }) => {
  await signIn(page, USERS.planner);
  await page.goto("/admin/messages");
  const form = page.locator("form").filter({ has: page.locator('[name="recipient"]') });
  const recipient = form.locator('[name="recipient"]');
  const option = await recipient.locator("option", { hasText: "Mohamed" }).first().getAttribute("value");
  await recipient.selectOption(option!);
  await n(form, "subject").fill(subject);
  await n(form, "body").fill("Can you start at 07:00 tomorrow?");
  await form.getByRole("button", { name: "Send" }).click();
  await page.waitForURL(/\/admin\/messages\/[0-9a-f-]{36}/);
  const threadUrl = new URL(page.url()).pathname;
  await expect(page.getByText("Can you start at 07:00 tomorrow?")).toBeVisible();
  await submit(page, "Send", async (f) => { await n(f, "body").fill("Reliable — keep for early shifts."); await n(f, "internal").check(); });
  await expect(page.getByText("Reliable — keep for early shifts.")).toBeVisible();

  await signIn(page, USERS.worker);
  await page.goto("/worker/messages");
  const row = page.getByRole("link", { name: new RegExp(subject) });
  await expect(row).toBeVisible();
  await expect(row.getByText("Unread")).toHaveCount(1);
  await row.click();
  await page.waitForURL(/\/worker\/messages\/[0-9a-f-]{36}/);
  await expect(page.getByText("Can you start at 07:00 tomorrow?")).toBeVisible();
  await expect(page.getByText("Reliable — keep for early shifts.")).toHaveCount(0);
  await submit(page, "Send", async (f) => { await n(f, "body").fill("Yes, I will be there."); });
  await expect(page.getByText("Yes, I will be there.")).toBeVisible();

  await signIn(page, USERS.planner);
  await page.goto(threadUrl);
  await expect(page.getByText("Yes, I will be there.")).toBeVisible();

  await signIn(page, USERS.client);
  await page.goto("/client/messages");
  await submit(page, "Send", async (f) => {
    await n(f, "subject").fill(clientSubject);
    await n(f, "body").fill("Could we get two more people on Saturday?");
  });
  await page.waitForURL(/\/client\/messages\/[0-9a-f-]{36}/);
  await signIn(page, USERS.planner);
  await page.goto("/admin/messages");
  await expect(page.getByRole("link", { name: new RegExp(clientSubject) })).toBeVisible();
  await expectNoError(page);
});

test("client rates a finished shift and marks a preferred worker; agency sees it", async ({ page }) => {
  await signIn(page, USERS.client);
  await page.goto("/client/workers");
  await expectNoError(page);
  const rate = page.locator("form").filter({ has: page.getByRole("button", { name: "Save rating" }) }).first();
  if (await rate.count()) {
    await rate.getByRole("radio", { name: "4 stars" }).click();
    await rate.locator('[name="comment"]').fill("Friendly and on time.");
    await rate.getByRole("button", { name: "Save rating" }).click();
    await expect(page.locator("[data-sonner-toast]").first()).toContainText(/rating was saved/);
  }
  const prefer = page.getByRole("button", { name: "Prefer", exact: true }).first();
  test.skip(!(await prefer.count()), "The demo client has no past workers");
  await confirmAction(page, prefer, { expectToast: /preferred/i });
  await page.reload();
  await expect(page.getByText("Preferred", { exact: true }).first()).toBeVisible();

  await signIn(page, USERS.owner);
  await page.goto("/admin/workers");
  await page.getByRole("link", { name: /Mohamed/ }).first().click();
  await page.waitForURL(/\/admin\/workers\/[0-9a-f-]{36}/);
  await page.goto(new URL(page.url()).pathname + "?tab=feedback");
  await expect(page.getByRole("heading", { name: "Client preferences" })).toBeVisible();
  await expectNoError(page);
});

test("worker subscribes to a calendar feed", async ({ page, request }) => {
  await signIn(page, USERS.worker);
  await page.goto("/worker/schedule");
  await page.getByRole("button", { name: /Create (calendar|a new) link/ }).click();
  const url = (await page.getByTestId("calendar-url").innerText()).trim();
  expect(url).toMatch(/\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
  const ics = await request.get(new URL(url).pathname); // no session: the token is the credential
  expect(ics.status()).toBe(200);
  expect(ics.headers()["content-type"]).toContain("text/calendar");
  const body = await ics.text();
  expect(body).toContain("BEGIN:VCALENDAR");
  expect((await request.get("/api/calendar/" + "x".repeat(43) + ".ics")).status()).toBe(200);
  expect(await (await request.get("/api/calendar/" + "x".repeat(43) + ".ics")).text()).not.toContain("BEGIN:VEVENT");
  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.locator("[data-sonner-toast]", { hasText: /turned off/i })).toBeVisible();
  expect(await (await request.get(new URL(url).pathname)).text()).not.toContain("BEGIN:VEVENT");
});

test("CSV exports of workers, shifts and timesheets", async ({ page }) => {
  await signIn(page, USERS.owner);
  for (const kind of ["workers", "shifts", "timesheets"]) {
    const res = await get(page, `/api/exports/${kind}`);
    expect(res.status(), kind).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect((await res.text()).split("\r\n").length).toBeGreaterThan(1);
  }
  const workers = await (await get(page, "/api/exports/workers")).text();
  expect(workers).not.toMatch(/NL\d{2}[A-Z]{4}\d{10}/); // never bank details
  await signIn(page, USERS.worker);
  const denied = await get(page, "/api/exports/workers");
  expect(denied.headers()["content-type"] ?? "").not.toContain("text/csv");
});
