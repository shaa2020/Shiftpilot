import { describe, expect, it } from "vitest";
import { applicationSchema, detectCvType } from "./application";

describe("public application validation", () => {
  const base = { first_name: "Sanne", last_name: "Bakker", email: "sanne@example.nl", privacy: "on" };
  it("requires the privacy acknowledgement", () => {
    expect(applicationSchema.safeParse({ ...base, privacy: undefined }).success).toBe(false);
    expect(applicationSchema.safeParse(base).success).toBe(true);
  });
  it("rejects bots that fill the honeypot", () => {
    expect(applicationSchema.safeParse({ ...base, website: "http://spam" }).success).toBe(false);
  });
  it("detects file types by content, not by name", () => {
    expect(detectCvType(new TextEncoder().encode("%PDF-1.7 ..."))?.mime).toBe("application/pdf");
    expect(detectCvType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))?.ext).toBe("docx");
    expect(detectCvType(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
    expect(detectCvType(new Uint8Array([0x4d, 0x5a]))).toBeNull(); // Windows executable
  });
});
