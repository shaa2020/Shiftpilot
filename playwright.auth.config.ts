import { defineConfig, devices } from "@playwright/test";

/** Signed-in flows; requires a running Supabase stack and `node scripts/seed-demo.mjs`. */
const port = Number(process.env.E2E_PORT ?? 3100);
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "tests/e2e-auth",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-auth" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "off", launchOptions: { executablePath }, ...devices["Desktop Chrome"] },
  webServer: process.env.E2E_NO_SERVER ? undefined : { command: `npx next start -p ${port}`, url: `http://127.0.0.1:${port}/privacy`, reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
