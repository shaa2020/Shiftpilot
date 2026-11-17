import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("CSV", () => {
  it("quotes separators and quotes", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
  });
  it("neutralises spreadsheet formulas but keeps negative numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });
  it("builds CRLF rows", () => {
    expect(toCsv(["a", "b"], [[1, null]])).toBe("a,b\r\n1,\r\n");
  });
});
