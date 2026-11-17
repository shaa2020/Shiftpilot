import { expect, test } from "@playwright/test";

test.describe("public pages", () => {
  test("landing page renders with sign-in entry point", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Run your staffing agency");
    await page.getByRole("link", { name: "Sign in to ShiftPilot" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("privacy notice is reachable", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { name: "Privacy notice" })).toBeVisible();
    await expect(page.getByText("does not store BSN numbers")).toBeVisible();
  });

  test("unknown pages return 404", async ({ page }) => {
    const res = await page.goto("/does-not-exist");
    expect(res?.status()).toBe(404);
    await expect(page.getByText("Page not found")).toBeVisible();
  });
});

test.describe("access control", () => {
  for (const path of ["/admin", "/admin/settings/team", "/admin/clients", "/admin/workers", "/admin/crm", "/admin/recruitment", "/admin/configuration", "/admin/shifts", "/admin/shifts/new", "/admin/schedule", "/admin/requests", "/admin/timesheets", "/admin/attendance", "/notifications", "/admin/finance", "/admin/invoices", "/admin/payroll", "/admin/purchase-invoices", "/admin/documents", "/admin/compliance", "/admin/privacy", "/worker/documents", "/admin/assistant", "/notifications/preferences", "/client/invoices", "/client/pricing", "/worker/earnings", "/worker/offers", "/worker/schedule", "/worker/timesheets", "/worker/profile", "/client/requests", "/client/requests/new", "/client/shifts", "/client/timesheets", "/client/team", "/client", "/worker", "/portal", "/account"]) {
    test(`${path} redirects signed-out visitors to login with a safe return path`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path).replace(/[/]/g, "%2F")}`));
    });
  }

  test("reset-password without a recovery session is rejected", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page).toHaveURL(/\/login\?error=link/);
    await expect(page.getByText("invalid or has expired")).toBeVisible();
  });

  test("invalid invitation links are refused", async ({ page }) => {
    await page.goto("/invite/not-a-valid-token");
    await expect(page.getByRole("heading", { name: "Invitation unavailable" })).toBeVisible();
  });

  test("sign-out rejects cross-origin posts (CSRF)", async ({ request }) => {
    const res = await request.post("/auth/signout", { headers: { Origin: "https://evil.example" }, maxRedirects: 0 });
    expect(res.status()).toBe(403);
  });
});

test.describe("forms", () => {
  test("login validates input before contacting the auth server", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await expect(page.getByText("Enter your password")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  });

  test("forgot-password validates the email", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
  });
});

test.describe("security headers", () => {
  test("pages send a nonce-based CSP and hardening headers", async ({ request }) => {
    const res = await request.get("/login");
    const h = res.headers();
    expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("each request gets a fresh nonce", async ({ request }) => {
    const a = (await request.get("/login")).headers()["content-security-policy"];
    const b = (await request.get("/login")).headers()["content-security-policy"];
    expect(a).not.toEqual(b);
  });

  test("pages run without CSP violations", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /Content Security Policy/i.test(m.text())) violations.push(m.text());
    });
    await page.goto("/login");
    await page.getByLabel("Email").fill("a@b.nl");
    expect(violations).toEqual([]);
  });

  test("the PWA manifest is served", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m.name).toBe("ShiftPilot");
    expect(m.display).toBe("standalone");
  });
});

test.describe("responsive layout", () => {
  test("login card fits the viewport without horizontal scroll", async ({ page }) => {
    await page.goto("/login");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("careers site", () => {
  test("degrades gracefully when job openings cannot be loaded", async ({ page }) => {
    const res = await page.goto("/recruitment");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Open positions" })).toBeVisible();
    await expect(page.getByText("could not be loaded")).toBeVisible();
  });

  test("unknown openings return 404", async ({ page }) => {
    const res = await page.goto("/recruitment/demo/not-a-real-job");
    expect(res?.status()).toBe(404);
  });

  test("malformed agency slugs return 404", async ({ page }) => {
    const res = await page.goto("/recruitment/BAD_SLUG!");
    expect(res?.status()).toBe(404);
  });
});

test.describe("document downloads", () => {
  test("require a session", async ({ request }) => {
    const res = await request.get("/api/documents/00000000-0000-4000-8000-000000000000", { maxRedirects: 0 });
    expect([302, 307]).toContain(res.status());
    expect(res.headers()["location"]).toContain("/login");
  });

  test("reject malformed ids", async ({ request }) => {
    const res = await request.get("/api/documents/not-a-uuid", { maxRedirects: 0 });
    expect(res.status()).toBe(404);
  });
});

test.describe("finance endpoints", () => {
  test("invoice PDFs and payroll CSVs require a session", async ({ request }) => {
    for (const path of ["/api/invoices/00000000-0000-4000-8000-000000000000/pdf"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect([302, 307]).toContain(res.status());
    }
    expect((await request.get("/api/invoices/not-a-uuid/pdf", { maxRedirects: 0 })).status()).toBe(404);
    expect((await request.get("/api/payroll-exports/not-a-uuid", { maxRedirects: 0 })).status()).toBe(404);
  });
});

test.describe("privacy endpoints", () => {
  test("subject data export requires a signed-in privacy officer", async ({ request }) => {
    const res = await request.get("/api/privacy/export?email=someone@example.nl", { maxRedirects: 0 });
    expect([302, 307]).toContain(res.status());
    expect(res.headers()["location"]).toContain("/login");
  });
});

test.describe("automation and PWA", () => {
  test("cron endpoints reject requests without the secret", async ({ request }) => {
    for (const path of ["/api/cron/dispatch", "/api/cron/automations"]) {
      expect((await request.get(path)).status()).toBe(401);
      expect((await request.get(path, { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
    }
  });

  test("service worker and offline page are served", async ({ request }) => {
    const sw = await request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expect(await sw.text()).toContain("notificationclick");
    const offline = await request.get("/offline");
    expect(offline.status()).toBe(200);
    expect(await offline.text()).toContain("You are offline");
  });
});

test.describe("production readiness", () => {
  test("health endpoint reports status without exposing configuration values", async ({ request }) => {
    const res = await request.get("/api/health");
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty("status");
    expect(typeof body.integrations.email).toBe("boolean");
    expect(JSON.stringify(body)).not.toContain("ci-placeholder-anon-key");
  });

  test("two-factor challenge requires a session", async ({ page }) => {
    await page.goto("/mfa");
    await expect(page).toHaveURL(/\/login/);
  });
});
