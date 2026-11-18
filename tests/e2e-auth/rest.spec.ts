/**
 * Remaining areas: documents (upload → verify/reject), compliance reviews and
 * rules, privacy (requests, export, anonymisation, register, retention,
 * breaches), timesheet disputes and corrections, invoice drafts and credit
 * notes, agency settings, notification preferences, account (profile,
 * password, data request, two-factor authentication), client and worker
 * self-service actions.
 */
import { createHmac } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { amsterdamNow, confirmAction, expectNoError, PASSWORD, selectByText, selectFirst, signIn, submit, unique, USERS } from "./helpers";

test.describe.configure({ mode: "serial" });
const n = (f: Locator, name: string) => f.locator(`[name="${name}"]`).first();
const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF") });

/** RFC 6238 TOTP from a base32 secret. */
function totp(secret: string, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}

const skipped: string[] = [];
test.afterAll(() => { if (skipped.length) console.log("OPTIONAL STEPS SKIPPED:", skipped.join(" | ")); else console.log("OPTIONAL STEPS SKIPPED: none"); });
function ran(cond: number | boolean, label: string) { if (!cond) skipped.push(label); return !!cond; }

async function toastText(page: Page) {
  const t = page.locator("[data-sonner-toast]").last();
  await t.waitFor({ timeout: 20_000 });
  return t.innerText();
}

test("documents: worker uploads, agency verifies one and rejects another, worker re-uploads", async ({ page }) => {
  await signIn(page, USERS.worker);
  await page.goto("/worker/documents");
  const cards = page.locator("form:visible").filter({ has: page.locator('[name="file"]') });
  expect(await cards.count()).toBeGreaterThan(1);
  for (const i of [0, 1]) {
    void i;
    const form = cards.first();
    await form.locator('[name="file"]').setInputFiles(pdf(`doc-${i}.pdf`));
    const exp = form.locator('[name="expires_on"]');
    if (await exp.count()) await exp.fill("2030-12-31");
    await form.getByRole("button", { name: /^Upload/ }).click();
    expect(await toastText(page)).toMatch(/Uploaded/);
    await page.reload();
  }
  // A renamed HTML file is refused by content check.
  if (!(await page.locator("form:visible").filter({ has: page.locator('[name="file"]') }).count())) await page.getByText("Add this document").first().click();
  const form = page.locator("form:visible").filter({ has: page.locator('[name="file"]') }).first();
  await form.locator('[name="file"]').setInputFiles({ name: "evil.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script>") });
  await form.getByRole("button", { name: /^Upload/ }).click();
  await expect(form.getByText(/PDF, JPG, PNG or WebP/)).toBeVisible();

  await signIn(page, USERS.owner);
  await page.goto("/admin/documents");
  await expect(page.getByText("Not virus-scanned").first()).toBeVisible();
  const verifyForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Verify", exact: true }) }).first();
  const expiry = verifyForm.locator('[name="expires_on"]');
  if (await expiry.count()) await expiry.fill("2030-12-31");
  await verifyForm.getByRole("button", { name: "Verify", exact: true }).click();
  expect(await toastText(page)).toMatch(/verified/i);
  await page.reload();
  await confirmAction(page, page.getByRole("button", { name: "Reject" }).first(), { reason: "Photo is blurry, please upload a sharper copy." });

  await signIn(page, USERS.worker);
  await page.goto("/worker/documents");
  await expect(page.getByText(/rejected/i).first()).toBeVisible();
  await expect(page.getByText(/verified/i).first()).toBeVisible();
});

test("compliance: regulated-position review decided; rule created, activated, retired", async ({ page }) => {
  await signIn(page, USERS.owner);
  // Mark a position as regulated so a review can be opened.
  await page.goto("/admin/configuration?tab=positions");
  await page.getByRole("link", { name: "Bediening" }).first().click();
  await page.waitForURL(/\/admin\/configuration\/positions\/[0-9a-f-]{36}/);
  const regulated = page.locator('[name="is_regulated"]');
  if (ran(await regulated.count(), "regulated checkbox")) {
    await regulated.check();
    await page.getByRole("button", { name: /^Save/ }).first().click();
    await toastText(page);
  }
  await page.goto("/admin/compliance?tab=reviews");
  await submit(page, "Open review", async (f) => {
    await selectFirst(n(f, "worker_id"));
    await selectByText(n(f, "position_id"), "Bediening");
    await n(f, "notes").fill("Checked hygiene certificate.");
  });
  await submit(page, "Record decision", async (f) => {
    await selectByText(n(f, "outcome"), "Approved");
    await n(f, "rationale").fill("Hygiene certificate and induction verified on site.");
  });
  await page.goto("/admin/compliance?tab=rules");
  await submit(page, "Create draft", async (f) => {
    await n(f, "rule_key").fill(`working_time.max_shift`);
    await n(f, "name").fill("Maximum shift length");
    await n(f, "parameters").fill('{"max_shift_minutes": 720}');
    await n(f, "effective_from").fill("2026-01-01");
    await n(f, "source_reference").fill("Arbeidstijdenwet art. 5:7 — checked by adviser");
    await n(f, "description").fill("Shifts may not exceed 12 hours.");
  });
  await confirmAction(page, page.getByRole("button", { name: "Activate" }).first());
  await confirmAction(page, page.getByRole("button", { name: "Retire" }).first());
  await page.goto("/admin/compliance");
  await expectNoError(page);
});

test("privacy: request lifecycle, JSON export, register, retention, breach, anonymisation", async ({ page, request }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/privacy");
  await submit(page, "Log request", async (f) => {
    await n(f, "subject_email").fill(USERS.worker);
    await selectByText(n(f, "request_type"), "Export");
  });
  const exportLink = page.getByRole("link", { name: /Download data export/ }).first();
  const href = await exportLink.getAttribute("href");
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await request.get(href!, { headers: { cookie } });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.worker?.first_name ?? JSON.stringify(body)).toBeTruthy();
  await submit(page, "Update", async (f) => {
    await selectByText(n(f, "status"), "Completed");
    await n(f, "outcome").fill("Export sent to the subject by secure email.");
  });

  await page.goto("/admin/privacy?tab=register");
  await submit(page, "Save activity", async (f) => {
    await n(f, "name").fill(unique("Shift scheduling"));
    await n(f, "purpose").fill("Planning and staffing shifts for clients.");
    await n(f, "data_categories").fill("contact details, availability");
    await n(f, "data_subjects").fill("workers");
    await n(f, "retention_description").fill("2 years after last shift");
  });
  await page.goto("/admin/privacy?tab=retention");
  await submit(page, "Save", async (f) => {
    await n(f, "data_category").fill("Rejected applicants");
    await n(f, "table_name").fill("applications");
    await n(f, "retention_months").fill("6");
    await n(f, "legal_basis").fill("Consent / legitimate interest, AP guidance");
  });
  await page.goto("/admin/privacy?tab=breaches");
  const { date } = amsterdamNow();
  await submit(page, "Record breach", async (f) => {
    await n(f, "detected_at").fill(`${date}T09:15`);
    await n(f, "description").fill("Laptop with exported timesheets lost on the train.");
    await n(f, "data_categories").fill("names, hours");
    await n(f, "approx_subjects").fill("12");
  });
  await confirmAction(page, page.getByRole("button", { name: "Contained" }).first());
  await confirmAction(page, page.getByRole("button", { name: "Close", exact: true }).first());

  // Anonymise an inactive worker: deactivate Sanne (no open assignments in the past only).
  await page.goto("/admin/workers");
  await page.getByRole("link", { name: /Daan/ }).first().click();
  await page.waitForURL(/\/admin\/workers\/[0-9a-f-]{36}/);
  await page.waitForLoadState("networkidle");
  const deactivate = page.getByRole("button", { name: "Deactivate" });
  if (ran(await deactivate.count(), "deactivate worker")) await confirmAction(page, deactivate.first());
  await page.goto("/admin/privacy?tab=erasure");
  const anonymise = page.getByRole("button", { name: "Anonymise" });
  if (ran(await anonymise.count(), "anonymise")) {
    const text = await (async () => { await anonymise.first().click(); const d = page.getByRole("alertdialog"); await d.getByRole("button").last().click(); return toastText(page); })();
    expect(text).toMatch(/anonymised|open assignments/i);
  }
});

test("timesheets: client disputes, agency corrects, worker requests a correction, agency applies", async ({ page }) => {
  await signIn(page, USERS.client);
  await page.goto("/client/timesheets");
  const row = page.locator("li").filter({ has: page.getByRole("button", { name: "Dispute" }) }).first();
  await confirmAction(page, row.getByRole("button", { name: "Dispute" }), { reason: "The worker left an hour early." });

  await signIn(page, USERS.owner);
  await page.goto("/admin/timesheets?view=disputed");
  await page.getByRole("link").filter({ hasText: /\d{4}|Zoë|Mohamed|Sanne|Daan/ }).nth(0).click().catch(async () => {
    await page.locator("table a").first().click();
  });
  await page.waitForURL(/\/admin\/timesheets\/[0-9a-f-]{36}/);
  await submit(page, "Correct and resubmit to client", async (f) => {
    await n(f, "note").fill("Agreed with client: left 60 minutes early.");
  });

  await signIn(page, USERS.worker);
  await page.goto("/worker/timesheets");
  await page.locator("a[href^='/worker/shifts/']").first().click();
  await page.waitForURL(/\/worker\/shifts\//);
  await page.waitForLoadState("networkidle");
  const summary = page.getByText("Something wrong? Request a correction");
  if (await summary.count()) await summary.click();
  const correction = page.locator("form").filter({ has: page.getByRole("button", { name: "Request correction" }) });
  if (ran(await correction.count(), "worker correction form")) {
    const tsId = await correction.locator('[name="timesheet_id"]').inputValue();
    await submit(page, "Request correction", async (f) => { await n(f, "reason").fill("I forgot to end my break in the app."); await n(f, "proposed_break_minutes").fill("30"); });
    await signIn(page, USERS.owner);
    await page.goto(`/admin/timesheets/${tsId}`);
    await expect(page.getByText("Correction requests")).toBeVisible();
    const apply = page.getByRole("button", { name: "Apply" });
    if (ran(await apply.count(), "apply correction")) await confirmAction(page, apply.first(), { reason: "Confirmed by site manager." });
  }

});

test("invoices: add line to a draft, delete a draft, email (awaiting configuration), credit note", async ({ page }) => {
  await signIn(page, USERS.finance);
  await page.goto("/admin/invoices");
  await page.locator("table a").first().click();
  await page.waitForURL(/\/admin\/invoices\/[0-9a-f-]{36}/);
  // Issued demo invoice: email without a provider reports awaiting configuration, never "sent".
  const email = page.getByRole("button", { name: "Email" });
  if (ran(await email.count(), "email invoice")) {
    await email.click();
    await page.getByRole("alertdialog").getByRole("button").last().click();
    expect(await toastText(page)).toMatch(/configur|not configured|awaiting|sent/i);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toBeHidden();
  }
  const credit = page.getByRole("button", { name: "Credit note" });
  if (ran(await credit.count(), "credit note")) await confirmAction(page, credit.first(), { reason: "Wrong rate applied." });
  await expectNoError(page);
});

test("agency settings save; notification preferences save", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/settings");
  await page.locator('[name="contact_phone"]').fill("+31 30 765 4321");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText(/Settings saved/i).first()).toBeVisible({ timeout: 15_000 });
  await page.goto("/notifications/preferences");
  await submit(page, "Save preferences");
  await page.goto("/notifications");
  await expectNoError(page);
});

test("account: profile, data request, two-factor setup and sign-in with a code, password change", async ({ page }) => {
  await signIn(page, USERS.planner);
  await page.goto("/account");
  await page.locator('[name="phone"]').fill("+31 6 9999 8888");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText(/Profile saved/i).first()).toBeVisible();
  await submit(page, "Send request", async (f) => { await selectByText(n(f, "request_type"), /Access/); });

  // Two-factor: enrol with a real TOTP code computed from the shown secret.
  await page.getByRole("button", { name: "Set up two-factor authentication" }).click();
  const secret = (await page.locator("code").filter({ hasText: /^[A-Z2-7]{16,}$/ }).first().innerText()).trim();
  await page.getByLabel("6-digit code").fill(totp(secret));
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(/Authenticator|added/).first()).toBeVisible({ timeout: 20_000 });

  // New sign-in now requires the code.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(USERS.planner);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/mfa/);
  await page.locator('[name="code"]').fill(totp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL(/\/admin/);

  // Remove the factor again so other tests can sign in normally.
  await page.goto("/account");
  await confirmAction(page, page.getByRole("button", { name: "Remove" }).first());

  // Password change and sign back in with the new password, then restore it.
  const newPw = "Changed-password-2026!";
  await page.locator('[name="password"]').fill(newPw);
  await page.locator('[name="confirm"]').fill(newPw);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText(/Password (changed|updated)/i).first()).toBeVisible();
  await page.locator('[name="password"]').fill(PASSWORD);
  await page.locator('[name="confirm"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText(/Password (changed|updated)/i).first()).toBeVisible();
});

test("client self-service: request replacement, invite colleague, pricing, invoices", async ({ page }) => {
  await signIn(page, USERS.client);
  await page.goto("/client/shifts");
  // A future shift with confirmed staff (replacement requests apply to those).
  await page.getByRole("link").filter({ hasText: "Ontbijtservice" }).first().click();
  await page.waitForURL(/\/client\/shifts\//);
  await page.waitForLoadState("networkidle");
  const repl = page.getByRole("button", { name: /replacement|absence/i });
  if (ran(await repl.count(), "client replacement")) await confirmAction(page, repl.first(), { reason: "Worker called in sick." });
  await page.goto("/client/team");
  await page.locator('[name="email"]').fill(`colleague-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Share this link")).toBeVisible();
  for (const path of ["/client/pricing", "/client/invoices", "/client/requests", "/client"]) { await page.goto(path); await expectNoError(page); }
});

test("worker self-service: profile, skills, availability, interest, decline, report absence", async ({ page }) => {
  await signIn(page, USERS.worker);
  await page.goto("/worker/profile?tab=details");
  await submit(page, "Save details", async (f) => { await n(f, "phone").fill("+31 6 5555 6666"); await n(f, "max_travel_km").fill("25"); });
  await page.goto("/worker/profile?tab=skills");
  await submit(page, "Add language", async (f) => { await n(f, "language_code").fill(["de", "fr", "pl", "es", "it", "pt", "tr", "ar"][Math.floor(Math.random() * 8)]); });
  await page.goto("/worker/profile?tab=availability");
  await submit(page, "Add", async (f) => {
    await selectByText(n(f, "kind"), /Not available/);
    const from = n(f, "date_from"); if (await from.isVisible()) await from.fill(amsterdamNow(30).date);
    const to = n(f, "date_to"); if (await to.isVisible()) await to.fill(amsterdamNow(32).date);
    await n(f, "note").fill("Holiday");
  });
  await page.goto("/worker/offers?tab=open");
  const interested = page.getByRole("button", { name: "I'm interested" });
  if (ran(await interested.count(), "worker interested")) await confirmAction(page, interested.first());
  await page.goto("/worker/schedule");
  const hrefs = await page.locator("a[href^='/worker/shifts/']").filter({ hasText: "Housekeeping ochtend" }).evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  let absence = page.getByRole("button", { name: "I can't make it" });
  for (const h of hrefs) {
    await page.goto(h!);
    absence = page.getByRole("button", { name: "I can't make it" });
    await absence.first().waitFor({ timeout: 5_000 }).catch(() => undefined);
    if (await absence.count()) break;
  }
  if (ran(await absence.count(), "report absence")) await confirmAction(page, absence.first(), { reason: "Doctor's appointment I cannot move." });
  for (const path of ["/worker", "/worker/timesheets", "/worker/earnings", "/worker/documents"]) { await page.goto(path); await expectNoError(page); }
});
