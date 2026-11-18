/**
 * Admin HQ core modules: configuration, clients (locations, contacts, portal
 * users, contracts, pricing) and workers (profile, verification, skills,
 * certificates, availability, onboarding, employment pathway, notes, status),
 * plus the worker invitation → sign-up → portal flow.
 */
import { expect, test, type Locator } from "@playwright/test";
import { confirmAction, expectNoError, selectByText, selectFirst, signIn, submit, unique, USERS } from "./helpers";

test.describe.configure({ mode: "serial" });
const n = (f: Locator, name: string) => f.locator(`[name="${name}"]`).first();
const skill = unique("Forklift driving");
const kitchenPosition = unique("Kitchen help");
const cert = unique("VCA Basis");
const clientName = unique("Test Client");
const firstName = "Ilse";
const lastName = unique("Tester").replace(" ", "");
let workerUrl = "";
let clientUrl = "";
let inviteLink = "";

test("configuration: industry, category, position, skill, certificate, qualification", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/configuration?tab=industries");
  await submit(page, "Add industry", async (f) => { await n(f, "name").fill(unique("Healthcare")); });
  await submit(page, "Add category", async (f) => { await n(f, "name").fill(unique("Kitchen")); });
  await page.goto("/admin/configuration?tab=positions");
  await submit(page, "Add position", async (f) => {
    await n(f, "name").fill(kitchenPosition);
    await n(f, "allows_freelancers").check();
  });
  await page.goto("/admin/configuration?tab=skills");
  await submit(page, "Add", async (f) => { await n(f, "name").fill(skill); await n(f, "category").fill("Logistics"); });
  await page.goto("/admin/configuration?tab=certificates");
  await submit(page, "Add", async (f) => { await n(f, "name").fill(cert); await n(f, "issuing_body").fill("SSVV"); await n(f, "validity_months").fill("120"); });
  await page.goto("/admin/configuration?tab=qualifications");
  await submit(page, "Add", async (f) => { await n(f, "name").fill(unique("MBO Logistiek")); });
  await page.goto("/admin/configuration?tab=skills");
  await expect(page.getByText(skill)).toBeVisible();
});

test("position requirements can be added", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/configuration?tab=positions");
  // Requirement goes on the test's own position, so demo positions stay matchable.
  await page.getByRole("link", { name: kitchenPosition }).first().click();
  await page.waitForURL(/\/admin\/configuration\/positions\//);
  await submit(page, "Add requirement", async (f) => {
    const type = n(f, "requirement_type");
    if (await type.count()) await selectByText(type, /skill/i);
    const sk = n(f, "skill_id");
    if (await sk.count()) await selectByText(sk, skill);
  });
  await expect(page.getByText(skill).first()).toBeVisible();
});

test("clients: create and edit", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/clients/new");
  await submit(page, "Create client", async (f) => {
    await n(f, "name").fill(clientName);
    await n(f, "kvk_number").fill(String(10000000 + Math.floor(Math.random() * 89999999)));
    await n(f, "billing_email").fill("billing@example.com");
    await n(f, "billing_city").fill("Amsterdam");
  });
  await page.waitForURL(/\/admin\/clients\/[0-9a-f-]{36}/);
  clientUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: clientName })).toBeVisible();
  await submit(page, "Save client", async (f) => { await n(f, "payment_term_days").fill("21"); });
});

test("clients: location, contact, portal user invitation", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto(`${clientUrl}?tab=locations`);
  await submit(page, "Add location", async (f) => {
    await n(f, "name").fill("Main site");
    await n(f, "address_line1").fill("Damrak 1");
    await n(f, "postal_code").fill("1012 LG");
    await n(f, "city").fill("Amsterdam");
    await n(f, "latitude").fill("52.3740");
    await n(f, "longitude").fill("4.8930");
  });
  await expect(page.getByText("Main site").first()).toBeVisible();
  await page.goto(`${clientUrl}?tab=contacts`);
  await submit(page, "Add contact", async (f) => {
    await n(f, "full_name").fill("Carla Contact");
    await n(f, "email").fill("carla@example.com");
  });
  await expect(page.getByText("Carla Contact").first()).toBeVisible();
  await page.goto(`${clientUrl}?tab=users`);
  await page.locator("#ci-email").fill(`portal-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Share this link")).toBeVisible();
  await expectNoError(page);
});

test("clients: contract lifecycle and pricing approval", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto(`${clientUrl}?tab=contracts`);
  await submit(page, "Create draft", async (f) => {
    await n(f, "reference").fill(unique("RAM"));
    await n(f, "title").fill("Raamovereenkomst");
    await n(f, "start_date").fill("2026-01-01");
  });
  await confirmAction(page, page.getByRole("button", { name: "Send for signature" }).first());
  await confirmAction(page, page.getByRole("button", { name: "Mark signed" }).first());
  await expect(page.getByText(/active/i).first()).toBeVisible();

  await page.goto(`${clientUrl}?tab=pricing`);
  await submit(page, "Create draft", async (f) => {
    await n(f, "name").fill("Tarieven test");
    await n(f, "effective_from").fill("2026-01-01");
  });
  await submit(page, "Add rule", async (f) => {
    await selectByText(n(f, "rule_kind"), /base/i);
    await n(f, "hourly_rate").fill("31.50");
  });
  await confirmAction(page, page.getByRole("button", { name: "Approve" }).first());
  await page.reload();
  await expect(page.getByText(/active/i).first()).toBeVisible();
});

test("workers: create, verify, skills, certificate, availability, notes", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/workers/new");
  await submit(page, "Create worker", async (f) => {
    await n(f, "first_name").fill(firstName);
    await n(f, "last_name").fill(lastName);
    await n(f, "email").fill(`ilse-${Date.now()}@example.com`);
    await n(f, "phone").fill("+31 6 1111 2222");
    await selectByText(n(f, "engagement_type"), /employee/i);
    await n(f, "city").fill("Utrecht");
  });
  await page.waitForURL(/\/admin\/workers\/[0-9a-f-]{36}/);
  workerUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: new RegExp(firstName) })).toBeVisible();

  await page.goto(`${workerUrl}?tab=compliance`);
  await submit(page, "Save", async (f) => {
    await selectByText(n(f, "identity_verification_status"), /verified/i);
    await selectByText(n(f, "work_eligibility_status"), /verified/i);
    await n(f, "date_of_birth").fill("1995-05-05");
  });

  await page.goto(`${workerUrl}?tab=skills`);
  await submit(page, "Add skill", async (f) => { await selectByText(n(f, "skill_id"), skill); });
  await submit(page, "Add language", async (f) => { await n(f, "language_code").fill("nl"); });
  await submit(page, "Add certificate", async (f) => {
    await selectByText(n(f, "certificate_id"), cert);
    await n(f, "issued_on").fill("2025-01-01");
    await n(f, "expires_on").fill("2035-01-01");
  });
  await confirmAction(page, page.getByRole("button", { name: "Verify" }).first());

  await page.goto(`${workerUrl}?tab=availability`);
  await submit(page, "Add", async (f) => {
    await selectByText(n(f, "kind"), /recurring|weekly/i);
    const day = n(f, "day_of_week");
    if (await day.isVisible()) await selectByText(day, "Monday");
    await n(f, "start_time").fill("08:00");
    await n(f, "end_time").fill("17:00");
  });

  await page.goto(`${workerUrl}?tab=notes`);
  await submit(page, "Add note", async (f) => { await n(f, "body").fill("Prefers morning shifts."); });
  await expect(page.getByText("Prefers morning shifts.")).toBeVisible();
});

test("workers: employment contract, wage, onboarding and activation", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto(`${workerUrl}?tab=pathway`);
  await submit(page, "Create draft", async (f) => {
    await n(f, "contract_number").fill(unique("AC").replace(" ", "-"));
    const kind = n(f, "contract_kind");
    if ((await kind.evaluate((e) => e.tagName)) === "SELECT") await selectFirst(kind); else await kind.fill("fase_a");
    await n(f, "start_date").fill("2026-01-01");
    await n(f, "contracted_hours_per_week").fill("24");
  });
  await confirmAction(page, page.getByRole("button", { name: "Send", exact: true }).first());
  await confirmAction(page, page.getByRole("button", { name: "Mark signed" }).first());
  await submit(page, "Add rate", async (f) => {
    const c = n(f, "contract_id");
    if ((await c.evaluate((e) => e.tagName)) === "SELECT") await selectFirst(c);
    await n(f, "hourly_gross").fill("15.75");
    await n(f, "effective_from").fill("2026-01-01");
  });

  await page.goto(`${workerUrl}?tab=onboarding`);
  const completes = page.getByRole("button", { name: "Complete" });
  for (let i = await completes.count(); i > 0; i--) {
    await confirmAction(page, page.getByRole("button", { name: "Complete" }).first());
  }
  await page.goto(workerUrl);
  await confirmAction(page, page.getByRole("button", { name: "Activate", exact: true }).first(), { expectToast: /./ });
  await page.reload();
  await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
});

test("workers: invitation link → sign up → worker portal", async ({ page, browser }) => {
  await signIn(page, USERS.owner);
  await page.goto(workerUrl);
  await page.getByRole("button", { name: "Invite to worker portal" }).click();
  await expect(page.getByText("Share this link")).toBeVisible();
  inviteLink = (await page.locator("code").filter({ hasText: "/invite/" }).first().innerText()).trim();
  expect(inviteLink).toMatch(/\/invite\/[A-Za-z0-9_-]+/);

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(new URL(inviteLink).pathname);
  await expectNoError(p);
  const pw = p.getByLabel(/password/i).first();
  if (await pw.isVisible().catch(() => false)) {
    const name = p.getByLabel(/full name|name/i).first();
    if (await name.isVisible().catch(() => false)) await name.fill(`${firstName} ${lastName}`);
    await pw.fill("Test-password-2026!");
    const confirm = p.getByLabel(/confirm/i).first();
    if (await confirm.isVisible().catch(() => false)) await confirm.fill("Test-password-2026!");
    await p.getByRole("button", { name: /create account|sign up|continue/i }).click();
  }
  const accept = p.getByRole("button", { name: /accept/i });
  await accept.waitFor({ timeout: 20_000 });
  await accept.click();
  await p.waitForURL(/\/worker/, { timeout: 20_000 });
  await expect(p.getByRole("heading", { name: new RegExp(`Hi ${firstName}`) })).toBeVisible();
  await ctx.close();
});
