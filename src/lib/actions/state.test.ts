import { describe, expect, it } from "vitest";
import { dbErrorMessage, formObject } from "./state";

describe("action helpers", () => {
  it("collects repeated form keys into arrays", () => {
    const fd = new FormData();
    fd.append("a", "1");
    fd.append("tags", "x");
    fd.append("tags", "y");
    expect(formObject(fd)).toEqual({ a: "1", tags: ["x", "y"] });
  });

  it("only exposes business-rule database messages", () => {
    expect(dbErrorMessage({ code: "P0001", message: "This position is already fully staffed" })).toBe("This position is already fully staffed");
    expect(dbErrorMessage({ code: "42501", message: 'new row violates row-level security policy for table "clients"' })).toBe("You are not allowed to make this change.");
    expect(dbErrorMessage({ code: "XX000", message: "internal detail with table names" })).toBe("The change could not be saved.");
    expect(dbErrorMessage({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe("A record with these details already exists.");
  });
});
