/**
 * Signed-in flows against a real Supabase stack seeded with scripts/seed-demo.mjs.
 * Run by the `e2e-supabase` CI job (Supabase CLI + Docker); not runnable without it.
 */
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.DEMO_PASSWORD ?? "ShiftPilot-demo-2026!";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe.configure({ mode: "serial" });

test("owner lands on Admin HQ and sees live operations", async ({ page }) => {
  await signIn(page, "eigenaar@example.com");
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.goto("/admin/shifts");
  await expect(page.getByText("Congres bediening").first()).toBeVisible();
  await page.goto("/admin/timesheets");
  await expect(page.getByRole("heading", { name: "Timesheets" })).toBeVisible();
  await page.goto("/admin/invoices");
  await expect(page.getByText(/INV-\d{4}-\d{5}/).first()).toBeVisible();
});

test("planner cannot open finance-only pages", async ({ page }) => {
  await signIn(page, "planner@example.com");
  await page.goto("/admin/payroll");
  await expect(page.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();
});

test("client sees only its own organisation and can review timesheets", async ({ page }) => {
  await signIn(page, "klant@example.com");
  await expect(page).toHaveURL(/\/client/);
  await expect(page.getByText("Hotel Domstad").first()).toBeVisible();
  await page.goto("/client/shifts");
  await expect(page.getByText("Logistiek Centrum Nieuwegein")).toHaveCount(0);
  await page.goto("/client/timesheets");
  await expect(page.getByRole("heading", { name: "Timesheets" })).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();
});

test("worker sees own shifts and pay, never another worker's", async ({ page }) => {
  await signIn(page, "medewerker@example.com");
  await expect(page).toHaveURL(/\/worker/);
  await expect(page.getByRole("heading", { name: /Hi Mohamed/ })).toBeVisible();
  await page.goto("/worker/schedule");
  await expect(page.getByText("Housekeeping").first()).toBeVisible();
  await expect(page.getByText("Sanne")).toHaveCount(0);
  await page.goto("/worker/documents");
  await expect(page.getByRole("heading", { name: "My documents" })).toBeVisible();
});

test("freelancer sees the freelancer pathway (purchase invoices), not payslips", async ({ page }) => {
  await signIn(page, "zzp@example.com");
  await page.goto("/worker/earnings");
  await expect(page.getByText(/invoice/i).first()).toBeVisible();
});

test("account page offers two-factor setup and data requests", async ({ page }) => {
  await signIn(page, "financien@example.com");
  await page.goto("/account");
  await expect(page.getByRole("button", { name: "Set up two-factor authentication" })).toBeVisible();
  await expect(page.getByText("Your personal data")).toBeVisible();
});

test("signing out from the account menu ends the session", async ({ page }) => {
  await signIn(page, "eigenaar@example.com");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});
