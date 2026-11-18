import { expect, type Locator, type Page } from "@playwright/test";

export const PASSWORD = process.env.DEMO_PASSWORD ?? "ShiftPilot-demo-2026!";
export const USERS = {
  owner: "eigenaar@example.com",
  planner: "planner@example.com",
  finance: "financien@example.com",
  client: "klant@example.com",
  worker: "medewerker@example.com",
  freelancer: "zzp@example.com",
} as const;

const SESSION_DIR = process.env.E2E_SESSION_DIR ?? "test-results/.sessions";

/**
 * Signs in as `email`. Sessions are cached per user and reused, so the suite
 * stays under the app's sign-in rate limit (10 attempts / 15 min per user).
 * Pass { fresh: true } to force a real password sign-in.
 */
export async function signIn(page: Page, email: string, opts: { fresh?: boolean } = {}) {
  const fs = await import("node:fs");
  const file = `${SESSION_DIR}/${email.replace(/[^a-z0-9]/gi, "_")}.json`;
  await page.context().clearCookies();
  if (!opts.fresh && fs.existsSync(file)) {
    await page.context().addCookies(JSON.parse(fs.readFileSync(file, "utf8")));
    await page.goto("/portal");
    if (!new URL(page.url()).pathname.startsWith("/login")) return;
    await page.context().clearCookies();
  }
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  if (!new URL(page.url()).pathname.startsWith("/mfa")) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(await page.context().cookies()));
  }
}

/** The form whose submit button has this label. */
export function formWith(page: Page | Locator, submit: string | RegExp): Locator {
  return page.locator("form").filter({ has: page.getByRole("button", { name: submit, exact: typeof submit === "string" }) }).first();
}

/** Fails if the page shows the error boundary or a form error alert. */
export async function expectNoError(page: Page) {
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  const alerts = page.locator('[role="alert"]').filter({ hasNotText: /^$/ });
  const n = await alerts.count();
  for (let i = 0; i < n; i++) {
    const t = (await alerts.nth(i).innerText()).trim();
    if (t && /could not|failed|not allowed|not authori|invalid|error|denied|violat|missing|required/i.test(t)) throw new Error(`Error shown on page: ${t}`);
  }
}

/** Submit a ServerForm and wait for its success toast (or a navigation). */
export async function submit(page: Page, submitLabel: string | RegExp, fill?: (form: Locator) => Promise<void>, expectText?: string | RegExp) {
  const form = formWith(page, submitLabel);
  await expect(form).toBeVisible();
  if (fill) await fill(form);
  const before = page.url();
  await form.getByRole("button", { name: submitLabel, exact: typeof submitLabel === "string" }).click();
  await Promise.race([
    page.locator("[data-sonner-toast]").first().waitFor({ timeout: 20_000 }),
    page.waitForURL((u) => u.toString() !== before, { timeout: 20_000 }),
    form.locator('[role="alert"]').first().waitFor({ timeout: 20_000 }),
    form.locator('[role="status"]').first().waitFor({ timeout: 20_000 }),
    form.locator('[id$="-error"]').first().waitFor({ timeout: 20_000 }),
  ]).catch(() => undefined);
  const formAlert = form.locator('[role="alert"]');
  if (await formAlert.count()) {
    const t = (await formAlert.first().innerText()).trim();
    if (t && !/saved|added|created|sent|recorded|success/i.test(t)) throw new Error(`Form "${submitLabel}" failed: ${t}`);
  }
  const fieldErrors = form.locator('[id$="-error"]');
  if (await fieldErrors.count()) throw new Error(`Form "${submitLabel}" field errors: ${(await fieldErrors.allInnerTexts()).join(" | ")}`);
  if (expectText) await expect(page.getByText(expectText).first()).toBeVisible({ timeout: 15_000 });
  await expectNoError(page);
}

/** Click a ConfirmAction trigger, optionally type a reason, and confirm. */
export async function confirmAction(page: Page, trigger: Locator, opts: { reason?: string; expectToast?: string | RegExp } = {}) {
  await trigger.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  const reasonBox = dialog.locator("#confirm-reason");
  if (opts.reason !== undefined) await reasonBox.fill(opts.reason);
  else if (await reasonBox.count()) await reasonBox.fill("Automated test entry");
  const before = page.url();
  const toasts = await page.locator("[data-sonner-toast]").count();
  await dialog.getByRole("button").last().click();
  // Success is a toast, or a redirect to another page.
  const toast = page.locator("[data-sonner-toast]").nth(toasts);
  const outcome = await Promise.race([
    toast.waitFor({ timeout: 20_000 }).then(() => "toast"),
    page.waitForURL((u) => u.toString() !== before, { timeout: 20_000 }).then(() => "navigated"),
  ]).catch(() => "none");
  if (outcome === "none") throw new Error("Action gave no feedback (no toast, no navigation)");
  let text = "";
  if (outcome === "toast") {
    text = await toast.innerText();
    if ((await toast.getAttribute("data-type")) === "error") throw new Error(`Action failed: ${text}`);
    if (opts.expectToast) expect(text).toMatch(opts.expectToast);
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }
  await expectNoError(page);
  return text;
}

/** Select the first option of a native select whose text matches. */
export async function selectByText(select: Locator, text: string | RegExp) {
  const options = await select.locator("option").allInnerTexts();
  const match = options.find((o) => (typeof text === "string" ? o.includes(text) : text.test(o)));
  if (!match) throw new Error(`No option matching ${text} in [${options.join(", ")}]`);
  await select.selectOption({ label: match });
}

/** Europe/Amsterdam local date (YYYY-MM-DD) and hour. */
export function amsterdamNow(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(d);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hour: "2-digit", hour12: false }).format(d));
  return { date, hour };
}
export const hhmm = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;
export const unique = (prefix: string) => `${prefix} ${Date.now().toString(36).slice(-5)}`;

/** Select the first option that has a value (skips "Choose…" placeholders). */
export async function selectFirst(select: import("@playwright/test").Locator) {
  const values = await select.locator("option").evaluateAll((os) => os.filter((o) => !(o as HTMLOptionElement).disabled && (o as HTMLOptionElement).value).map((o) => (o as HTMLOptionElement).value));
  if (!values.length) throw new Error("Select has no choosable options");
  await select.selectOption(values[0]);
}
