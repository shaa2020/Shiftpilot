import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isAuthorisedCron } from "./cron-auth";

describe("cron authorisation", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("rejects everything when CRON_SECRET is unset or too short", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isAuthorisedCron("Bearer ")).toBe(false);
    vi.stubEnv("CRON_SECRET", "short");
    expect(isAuthorisedCron("Bearer short")).toBe(false);
  });
  it("accepts only the exact bearer secret", () => {
    vi.stubEnv("CRON_SECRET", "a-very-long-cron-secret-value");
    expect(isAuthorisedCron("Bearer a-very-long-cron-secret-value")).toBe(true);
    expect(isAuthorisedCron("Bearer a-very-long-cron-secret-valuf")).toBe(false);
    expect(isAuthorisedCron("a-very-long-cron-secret-value")).toBe(false);
    expect(isAuthorisedCron(null)).toBe(false);
  });
});
