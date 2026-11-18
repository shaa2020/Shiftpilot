/**
 * Operations modules: CRM, recruitment (public application with CV → hire),
 * staffing requests (client → agency), shift management, staff attendance
 * entries, payroll exports, freelancer purchase invoices, finance holidays,
 * team invitations and read-only admin pages.
 */
import { expect, test, type Locator } from "@playwright/test";
import { amsterdamNow, confirmAction, expectNoError, hhmm, selectByText, selectFirst, signIn, submit, unique, USERS } from "./helpers";

test.describe.configure({ mode: "serial" });
const n = (f: Locator, name: string) => f.locator(`[name="${name}"]`).first();
const lead = unique("Bakkerij De Korst");
const opening = unique("Host / hostess");

test("CRM: create lead, log activity, convert to client", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/crm");
  await page.getByRole("button", { name: "New lead" }).click();
  await submit(page, "Create lead", async (f) => {
    await n(f, "company_name").fill(lead);
    await n(f, "contact_name").fill("Bert Bakker");
    await n(f, "email").fill("bert@example.com");
    await n(f, "estimated_monthly_hours").fill("120");
  });
  await page.waitForURL(/\/admin\/crm\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: lead })).toBeVisible();
  await submit(page, "Log activity", async (f) => {
    await selectFirst(n(f, "activity_type"));
    await n(f, "subject").fill("Intro call");
    await n(f, "body").fill("Interested in weekend staff.");
  });
  await expect(page.getByText("Intro call").first()).toBeVisible();
  await confirmAction(page, page.getByRole("button", { name: /Won|Convert/ }).first());
  await page.goto("/admin/clients");
  await expect(page.getByText(lead).first()).toBeVisible();
});

test("recruitment: publish opening, public application with CV, interview, hire", async ({ page, browser }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/recruitment?tab=openings");
  await submit(page, "Save draft", async (f) => {
    await n(f, "title").fill(opening);
    const pos = n(f, "position_id");
    if (await pos.count()) await selectByText(pos, "Bediening");
    await n(f, "location_city").fill("Utrecht");
    await n(f, "description").fill("Welcome guests at our client hotels in Utrecht. Friendly, punctual and well-presented.");
  });
  const row = page.getByRole("row").filter({ hasText: opening });
  await confirmAction(page, row.getByRole("button", { name: "Publish" }));

  // Public careers site, as an anonymous applicant.
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto("/recruitment/demo");
  await p.getByRole("link", { name: new RegExp(opening) }).first().click();
  await p.locator('[name="first_name"]').fill("Anna");
  await p.locator('[name="last_name"]').fill(unique("Applicant").replace(" ", ""));
  await p.locator('[name="email"]').fill(`anna-${Date.now()}@example.com`);
  await p.locator('[name="phone"]').fill("+31 6 3333 4444");
  await p.locator('[name="city"]').fill("Utrecht");
  await p.locator('[name="motivation"]').fill("I love hospitality and have two years of experience.");
  await p.locator('[name="cv"]').setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF") });
  await p.locator('[name="privacy"]').check();
  await p.getByRole("button", { name: "Send application" }).click();
  await expect(p.getByText(/received|thank you/i).first()).toBeVisible({ timeout: 20_000 });
  await ctx.close();

  await page.goto("/admin/recruitment?tab=applications");
  await page.getByRole("link", { name: /Anna/ }).first().click();
  await page.waitForURL(/\/admin\/recruitment\/applications\//);
  const { date } = amsterdamNow(2);
  await submit(page, "Schedule interview", async (f) => {
    await n(f, "scheduled_at").fill(`${date}T10:00`);
    await n(f, "duration_minutes").fill("30");
  });
  await submit(page, "Add note", async (f) => { await n(f, "body").fill("Strong candidate."); });
  // Move through the pipeline until "Hire" is offered.
  for (let i = 0; i < 6 && !(await page.getByRole("button", { name: "Hire" }).count()); i++) {
    const next = page.getByRole("button", { name: /screening|interview|offer|approve|qualified/i }).first();
    if (!(await next.count())) break;
    await confirmAction(page, next);
    await page.reload();
  }
  await confirmAction(page, page.getByRole("button", { name: "Hire" }).first());
  await page.goto("/admin/workers");
  await expect(page.getByText("Anna").first()).toBeVisible();
});

test("staffing request: client sends, agency accepts and shifts are created", async ({ page }) => {
  await signIn(page, USERS.client);
  await page.goto("/client/requests/new");
  const { date } = amsterdamNow(10);
  const ref = unique("PO");
  await submit(page, "Send request", async (f) => {
    await selectFirst(n(f, "location_id"));
    await selectByText(n(f, "position_id"), "Bediening");
    await n(f, "headcount").fill("2");
    await n(f, "date").fill(date);
    await n(f, "start_time").fill("17:00");
    await n(f, "end_time").fill("23:00");
    await n(f, "client_reference").fill(ref);
  });
  await signIn(page, USERS.planner);
  await page.goto("/admin/requests");
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00Z`));
  await page.getByRole("link", { name: label, exact: true }).first().click();
  await page.waitForURL(/\/admin\/requests\/[0-9a-f-]{36}/);
  await confirmAction(page, page.getByRole("button", { name: "Accept & create shifts" }));
  await page.goto("/admin/shifts");
  await expectNoError(page);
});

test("shift management: edit, add position, duplicate, direct assign, withdraw, cancel", async ({ page }) => {
  await signIn(page, USERS.planner);
  await page.goto("/admin/shifts/new");
  const { date } = amsterdamNow(4);
  const title = unique("Ops shift");
  await submit(page, "Create shift", async (f) => {
    await selectByText(n(f, "location_id"), "Centrum");
    await n(f, "title").fill(title);
    await n(f, "date").fill(date);
    await n(f, "start_time").fill("12:00");
    await n(f, "end_time").fill("16:00");
    await selectByText(n(f, "position_id"), "Schoonmaker");
    await n(f, "headcount").fill("2");
  });
  await page.waitForURL(/\/admin\/shifts\/[0-9a-f-]{36}/);
  const url = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "Reschedule" }).click();
  await submit(page, "Save", async (f) => { await n(f, "start_time").fill("12:30"); });
  await page.keyboard.press("Escape");
  await submit(page, "Add position", async (f) => { await selectByText(n(f, "position_id"), "Bediening"); await n(f, "headcount").fill("1"); });
  await page.goto(url);
  await page.getByRole("button", { name: "Headcount" }).first().click();
  await submit(page, "Save", async (f) => { await n(f, "headcount").fill("3"); });
  await page.goto(url);
  // Direct assignment of an eligible worker, then cancel it.
  await confirmAction(page, page.getByRole("button", { name: "Assign", exact: true }).first());
  await page.reload();
  await confirmAction(page, page.getByRole("button", { name: "Cancel", exact: true }).first());
  // Duplicate to another day.
  await page.goto(url);
  await page.getByRole("button", { name: "Duplicate" }).first().click();
  await submit(page, "Duplicate", async (f) => { await n(f, "date").fill(amsterdamNow(5).date); });
  await page.goto(url);
  await confirmAction(page, page.getByRole("button", { name: "Cancel shift" }));
  await page.reload();
  await expect(page.getByText(/cancelled/i).first()).toBeVisible();
});

test("attendance: staff records a check-in on behalf of a worker", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/attendance");
  await expect(page.getByRole("heading", { name: "Record on behalf of a worker" })).toBeVisible();
  await submit(page, "Record", async (f) => {
    await selectByText(n(f, "assignment_id"), "Retourverwerking");
    await selectByText(n(f, "event_type"), /check.?in/i);
    const { date, hour } = amsterdamNow();
    await n(f, "occurred_at").fill(`${date}T${hhmm(hour - 1)}`);
    await n(f, "note").fill("Phone battery empty, confirmed by site manager.");
  });
});

test("payroll: create period, generate export, download CSV", async ({ page, request }) => {
  await signIn(page, USERS.finance);
  await page.goto("/admin/payroll");
  await submit(page, "Create period", async (f) => {
    await n(f, "name").fill(unique("Week"));
    await selectFirst(n(f, "frequency"));
    await n(f, "period_start").fill(amsterdamNow(-20).date);
    await n(f, "period_end").fill(amsterdamNow(0).date);
  });
  await confirmAction(page, page.getByRole("button", { name: /Generate export|Regenerate/ }).first());
  await page.reload();
  const href = await page.getByRole("link", { name: "CSV" }).first().getAttribute("href");
  expect(href).toMatch(/\/api\/payroll-exports\//);
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const csv = await request.get(href!, { headers: { cookie } });
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
});

test("freelancer invoice: freelancer submits, finance approves and marks paid", async ({ page }) => {
  await signIn(page, USERS.freelancer);
  await page.goto("/worker/earnings");
  const boxes = page.locator('[name="timesheet_ids"]');
  if (!(await boxes.count())) test.skip(true, "No approved, uninvoiced timesheets for the freelancer");
  await boxes.first().check();
  await submit(page, "Submit invoice", async (f) => {
    await n(f, "supplier_invoice_number").fill(unique("ZZP").replace(" ", "-"));
    await n(f, "payee_name").fill("Zoë Zelfstandige");
    await n(f, "payee_iban").fill("NL91ABNA0417164300");
  });
  await signIn(page, USERS.finance);
  await page.goto("/admin/purchase-invoices");
  await confirmAction(page, page.getByRole("button", { name: "Approve" }).first());
  await page.reload();
  await confirmAction(page, page.getByRole("button", { name: "Mark paid" }).first());
});

test("finance: public holiday add and remove; overview renders", async ({ page }) => {
  await signIn(page, USERS.finance);
  await page.goto("/admin/finance");
  const name = unique("Koningsdag");
  await submit(page, "Add holiday", async (f) => { await n(f, "holiday_date").fill(`${new Date().getFullYear() + 1}-04-27`); await n(f, "name").fill(name); });
  await expect(page.getByText(name)).toBeVisible();
  const row = page.locator("li, tr").filter({ hasText: name }).filter({ has: page.getByRole("button", { name: "Remove" }) }).last();
  await confirmAction(page, row.getByRole("button", { name: "Remove" }));
});

test("team: invite staff with a role; roles and audit log render", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/settings/team");
  await page.locator('[name="email"]').fill(`staff-${Date.now()}@example.com`);
  const role = page.locator('[name="role_id"]');
  if (await role.count()) await selectFirst(role);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Share this link")).toBeVisible();
  await confirmAction(page, page.getByRole("button", { name: "Revoke" }).first());
  for (const path of ["/admin/settings/roles", "/admin/audit-log", "/admin/assistant", "/admin/schedule", "/admin"]) {
    await page.goto(path);
    await expectNoError(page);
  }
});
