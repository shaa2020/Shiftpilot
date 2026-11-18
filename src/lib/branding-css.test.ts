import { describe, expect, it } from "vitest";
import { brandCss, readableOn } from "./branding-css";

describe("brand colour CSS", () => {
  it("only accepts #rrggbb colours", () => {
    expect(brandCss("#0F766E")).toContain("--primary:#0f766e");
    expect(brandCss("red")).toBe("");
    expect(brandCss("#000;}body{display:none")).toBe("");
    expect(brandCss(null)).toBe("");
  });

  it("picks a readable text colour", () => {
    expect(readableOn("#1e3a8a")).toBe("#ffffff");
    expect(readableOn("#facc15")).toBe("#0b1220");
    expect(readableOn("#ffffff")).toBe("#0b1220");
  });
});
