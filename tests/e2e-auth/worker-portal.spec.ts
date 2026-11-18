/**
 * Worker portal on a phone: home, schedule grouped by day, shift details with
 * quick actions, single-shift calendar file, message prefill, offers tabs,
 * timesheets — and no horizontal scrolling anywhere.
 */
import { devices, expect, test } from "@playwright/test";
import { expectNoError, signIn, USERS } from "./helpers";

test.use({ ...devices["Pixel 7"] });
test.describe.configure({ mode: "serial" });

test("home shows the next shift, quick links and hours", async ({ page }) => {
  await signIn(page, USERS.worker);
  await page.goto("/worker");
  await expect(page.getByRole("heading", { name: /(Good (morning|afternoon|evening)), Mohamed/ })).toBeVisible();
  await expect(page.getByText("Next shift")).toBeVisible();
  for (const l of ["Offers", "Schedule", "Messages", "Hours", "Earnings", "Availability"]) await expect(page.getByRole("link", { name: new RegExp(`^${l}`) }).first()).toBeVisible();
  await expect(page.getByText("Worked this week")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Quick navigation" });
  for (const tab of ["Home", "Offers", "Schedule", "Messages", "More"]) await expect(nav.getByText(tab, { exact: true })).toBeVisible();
  await expectNoError(page);
});

test("schedule is grouped by day and opens organised shift details", async ({ page }) => {
  await signIn(page, USERS.worker);
  await page.goto("/worker/schedule");
  await expect(page.getByText("Next 7 days")).toBeVisible();
  await expect(page.locator("section h2").first()).toHaveText(/Today|Tomorrow|day /);
  await page.locator("a[href^='/worker/shifts/']").first().click();
  await page.waitForURL(/\/worker\/shifts\/[0-9a-f-]{36}/);
  const shiftPath = new URL(page.url()).pathname;
  for (const h of ["Where", "What to know"]) await expect(page.getByRole("heading", { name: h })).toBeVisible();
  for (const label of ["Time", "Length", "Paid"]) await expect(page.locator("dt", { hasText: label }).first()).toBeVisible();
  const bar = page.getByRole("navigation", { name: "Shift actions" });
  await expect(bar).toBeVisible();
  await expect(bar.getByText("Ask agency")).toBeVisible();

  // One-shift calendar file.
  const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const ics = await page.request.get(`/api/worker/shifts/${shiftPath.split("/").pop()}/ics`, { headers: { cookie } });
  expect(ics.status()).toBe(200);
  expect(await ics.text()).toContain("BEGIN:VEVENT");

  // "Ask agency" opens a new message about this shift.
  await bar.getByText("Ask agency").click();
  await page.waitForURL(/\/worker\/messages\?subject=/);
  expect(await page.locator('[name="subject"]').inputValue()).not.toBe("");
  await expectNoError(page);
});

test("offers are split into offers for you and open shifts", async ({ page }) => {
  await signIn(page, USERS.worker);
  await page.goto("/worker/offers");
  await expect(page.getByRole("link", { name: /For you/ })).toBeVisible();
  await page.getByRole("link", { name: /Open shifts/ }).click();
  await page.waitForURL(/tab=open/);
  await expectNoError(page);
});

test("timesheets show approval summary as cards", async ({ page }) => {
  await signIn(page, USERS.worker);
  await page.goto("/worker/timesheets?view=all");
  await expect(page.getByText("Waiting for approval")).toBeVisible();
  await expect(page.getByText("Approved").first()).toBeVisible();
  await expectNoError(page);
});

test("no worker page scrolls sideways on a phone", async ({ page }) => {
  await signIn(page, USERS.worker);
  await page.goto("/worker/schedule");
  const shift = await page.locator("a[href^='/worker/shifts/']").first().getAttribute("href");
  for (const path of ["/worker", "/worker/offers", "/worker/offers?tab=open", "/worker/schedule", "/worker/schedule?view=history", shift!, "/worker/timesheets", "/worker/messages", "/worker/earnings", "/worker/documents", "/worker/profile", "/worker/profile?tab=feedback"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
    await expectNoError(page);
  }
});
