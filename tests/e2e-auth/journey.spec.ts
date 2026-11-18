/**
 * The core business journey across four roles, on a fresh seeded stack:
 * planner creates and staffs a shift → freelancer accepts → agency confirms →
 * freelancer checks in, takes a break, checks out → client approves the hours →
 * agency approves → finance invoices, issues, records payment, downloads PDF/UBL.
 */
import { expect, test } from "@playwright/test";
import { amsterdamNow, confirmAction, expectNoError, hhmm, selectByText, signIn, submit, unique, USERS } from "./helpers";

test.describe.configure({ mode: "serial" });
const title = unique("Journey shift");
let shiftUrl = "";

test("planner creates a shift and invites an eligible freelancer", async ({ page }) => {
  await signIn(page, USERS.planner);
  await page.goto("/admin/shifts/new");
  const { date, hour } = amsterdamNow();
  await submit(page, "Create shift", async (f) => {
    await selectByText(f.locator('[name="location_id"]'), "Centrum");
    await f.locator('[name="title"]').fill(title);
    await f.locator('[name="date"]').fill(date);
    await f.locator('[name="start_time"]').fill(hhmm(hour));
    await f.locator('[name="end_time"]').fill(hhmm(hour + 3));
    await f.locator('[name="break_minutes"]').fill("15");
    await selectByText(f.locator('[name="position_id"]'), "Schoonmaker");
    await f.locator('[name="headcount"]').fill("1");
    await f.locator('[name="allow_freelancers"]').check();
  });
  await page.waitForURL(/\/admin\/shifts\/[0-9a-f-]{36}/);
  shiftUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // Matching panel: Zoë (freelancer) is eligible for this time slot.
  const zoe = page.getByLabel(/Select Zoë Zelfstandige/);
  await expect(zoe).toBeEnabled();
  await zoe.check();
  await submit(page, "Invite selected workers");
  await page.reload();
  await expect(page.getByText(/pending|invited/i).first()).toBeVisible();
});

test("freelancer accepts the offer", async ({ page }) => {
  await signIn(page, USERS.freelancer);
  await page.goto("/worker/offers");
  const card = page.locator("li, article, div").filter({ hasText: title }).filter({ has: page.getByRole("button", { name: "Accept" }) }).last();
  await expect(card).toBeVisible();
  await confirmAction(page, card.getByRole("button", { name: "Accept" }));
});

test("planner confirms the assignment (rates are locked)", async ({ page }) => {
  await signIn(page, USERS.planner);
  await page.goto(shiftUrl);
  await confirmAction(page, page.getByRole("button", { name: "Confirm", exact: true }));
  await page.reload();
  await expect(page.getByText(/confirmed/i).first()).toBeVisible();
});

test("freelancer checks in, takes a break and checks out", async ({ page }) => {
  await signIn(page, USERS.freelancer);
  const shiftId = shiftUrl.split("/").pop();
  await page.goto("/worker/schedule");
  await page.getByRole("link", { name: new RegExp(title) }).first().click();
  await page.waitForURL(/\/worker\/shifts\//);
  for (const [button, after] of [["Check in", "Start break"], ["Start break", "End break"], ["End break", "Check out"], ["Check out", null]] as const) {
    await page.getByRole("button", { name: button }).click();
    if (after) await expect(page.getByRole("button", { name: after })).toBeVisible({ timeout: 20_000 });
  }
  await expect(page.getByText(/checked out|completed|submitted/i).first()).toBeVisible({ timeout: 20_000 });
  await expectNoError(page);
  expect(shiftId).toBeTruthy();
});

test("client approves the submitted hours", async ({ page }) => {
  await signIn(page, USERS.client);
  await page.goto("/client/timesheets");
  const row = page.locator("li").filter({ hasText: title }).filter({ has: page.getByRole("button", { name: "Approve", exact: true }) }).last();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Zoë Z.");
  await confirmAction(page, row.getByRole("button", { name: "Approve", exact: true }));
});

test("agency approves client-approved timesheets in bulk", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/timesheets?view=client_approved");
  const boxes = page.getByRole("checkbox", { name: "Select" });
  const n = await boxes.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
  await submit(page, "Approve selected");
  await page.goto("/admin/timesheets?view=agency_approved");
  await expect(page.getByText("Zoë").first()).toBeVisible();
});

test("finance generates, issues and records payment for an invoice; PDF and UBL download", async ({ page, request }) => {
  await signIn(page, USERS.finance);
  await page.goto("/admin/invoices");
  const { date } = amsterdamNow();
  const from = amsterdamNow(-14).date;
  await submit(page, "Generate draft", async (f) => {
    await selectByText(f.locator('[name="client_id"]'), "Hotel Domstad");
    await f.locator('[name="period_start"]').fill(from);
    await f.locator('[name="period_end"]').fill(date);
  });
  await page.waitForURL(/\/admin\/invoices\/[0-9a-f-]{36}/);
  const invoiceUrl = new URL(page.url()).pathname;
  await expect(page.getByText(/draft/i).first()).toBeVisible();
  await confirmAction(page, page.getByRole("button", { name: "Issue invoice" }));
  await page.reload();
  await expect(page.getByText(/INV-\d{4}-\d{5}/).first()).toBeVisible();

  const total = (await page.getByText(/Total/).first().locator("..").innerText()).match(/€\s?[\d.,]+/)?.[0];
  await submit(page, "Record payment", async (f) => {
    await f.locator('[name="amount"]').fill("10");
    await f.locator('[name="reference"]').fill("TEST-PAY-1");
  });
  await page.reload();
  await expect(page.getByText(/partially paid|partially_paid/i).first()).toBeVisible();

  // Downloads use the signed-in session.
  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const id = invoiceUrl.split("/").pop();
  const pdf = await request.get(`/api/invoices/${id}/pdf`, { headers: { cookie: cookieHeader } });
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const ubl = await request.get(`/api/invoices/${id}/ubl`, { headers: { cookie: cookieHeader } });
  expect(ubl.status()).toBe(200);
  expect(await ubl.text()).toContain("<cbc:CustomizationID>urn:cen.eu:en16931:2017");
  expect(total).toBeTruthy();
});
