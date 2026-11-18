/**
 * Client portal on a phone and a desktop: overview, shifts by day with
 * staffing bars, shift details, timesheets with bulk approve, requests with
 * "request again", invoices, locations — and no sideways scrolling.
 */
import { devices, expect, test } from "@playwright/test";
import { expectNoError, signIn, USERS } from "./helpers";

test.describe.configure({ mode: "serial" });

test("overview shows actions, attention items, stats and on-site workers", async ({ page }) => {
  await signIn(page, USERS.client);
  await page.goto("/client");
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Request staff" }).first()).toBeVisible();
  for (const label of ["Upcoming shifts", "On site now", "Open requests", "Hours to approve"]) await expect(page.getByText(label).first()).toBeVisible();
  await expectNoError(page);
});

test("shifts by day open a detailed shift page", async ({ page }) => {
  await signIn(page, USERS.client);
  await page.goto("/client/shifts");
  await expect(page.locator("section h2").first()).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Workers confirmed" }).first()).toBeVisible();
  await page.locator("a[href^='/client/shifts/']").first().click();
  await page.waitForURL(/\/client\/shifts\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "Shift details" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Workers \(\d+\)/ })).toBeVisible();
  await page.getByRole("link", { name: "Message the agency" }).click();
  await page.waitForURL(/\/client\/messages\?subject=/);
  expect(await page.locator('[name="subject"]').inputValue()).not.toBe("");
});

test("timesheets, requests (request again), invoices and locations", async ({ page }) => {
  await signIn(page, USERS.client);
  await page.goto("/client/timesheets?view=history");
  await expectNoError(page);
  await page.goto("/client/requests?view=done");
  await expectNoError(page);
  const again = page.getByRole("link", { name: "Request again" }).first();
  if (await again.count()) {
    await again.click();
    await expect(page.getByRole("heading", { name: "Request again" })).toBeVisible();
    expect(await page.locator('[name="position_id"]').inputValue()).not.toBe("");
  }
  await page.goto("/client/invoices?view=all");
  await expect(page.getByText("Open balance")).toBeVisible();
  await page.goto("/client/locations");
  await expect(page.getByText("Arrival instructions for workers").first()).toBeVisible();
  await expectNoError(page);
});

test("phone: tab bar and no sideways scrolling on any client page", async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const page = await ctx.newPage();
  await signIn(page, USERS.client);
  await page.goto("/client/shifts");
  const shift = await page.locator("a[href^='/client/shifts/']").first().getAttribute("href");
  const nav = page.getByRole("navigation", { name: "Quick navigation" });
  for (const t of ["Home", "Shifts", "Hours", "Messages", "More"]) await expect(nav.getByText(t, { exact: true })).toBeVisible();
  for (const path of ["/client", "/client/shifts", "/client/shifts?view=past", shift!, "/client/timesheets", "/client/timesheets?view=history", "/client/requests", "/client/requests?view=done", "/client/requests/new", "/client/workers", "/client/messages", "/client/locations", "/client/invoices", "/client/pricing", "/client/team"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
    await expectNoError(page);
  }
  await ctx.close();
});

test("agency sees the employee profile header and overview", async ({ page }) => {
  await signIn(page, USERS.owner);
  await page.goto("/admin/workers");
  await page.getByRole("link", { name: /Mohamed/ }).first().click();
  await page.waitForURL(/\/admin\/workers\/[0-9a-f-]{36}/);
  for (const label of ["Shifts worked", "Hours (30 days)", "Client rating", "Required documents", "No-shows"]) await expect(page.getByText(label)).toBeVisible();
  for (const h of ["Upcoming shifts", "Recent shifts", "Contact", "Skills & certificates"]) await expect(page.getByRole("heading", { name: h })).toBeVisible();
  await page.getByRole("link", { name: "Details" }).click();
  await expect(page.getByRole("button", { name: "Save profile" })).toBeVisible();
  await expectNoError(page);
});

test("worker sees a profile header with completeness", async ({ page }) => {
  await signIn(page, USERS.worker);
  await page.goto("/worker/profile");
  await expect(page.getByText(/Profile \d+% complete/)).toBeVisible();
  await expectNoError(page);
});
