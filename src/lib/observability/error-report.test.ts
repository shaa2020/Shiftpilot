import { describe, expect, it } from "vitest";
import { buildEvent, parseDsn } from "./error-report";

describe("error reporting", () => {
  it("parses Sentry DSNs and rejects malformed ones", () => {
    expect(parseDsn("https://abc123@o1.ingest.sentry.io/456")).toEqual({ storeUrl: "https://o1.ingest.sentry.io/api/456/store/", publicKey: "abc123" });
    expect(parseDsn("http://abc@host/1")).toBeNull();
    expect(parseDsn("https://host/1")).toBeNull();
    expect(parseDsn("nonsense")).toBeNull();
    expect(parseDsn(undefined)).toBeNull();
  });
  it("never includes query strings or headers", () => {
    const ev = buildEvent(new Error("boom"), { path: "/invite/abc?token=secret", method: "GET", routeType: "render" }, "e1");
    const json = JSON.stringify(ev);
    expect(json).not.toContain("secret");
    expect(json).not.toContain("cookie");
    expect(ev.exception.values[0].value).toBe("boom");
  });
});
