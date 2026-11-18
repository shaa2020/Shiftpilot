import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { geocode, parsePdokPoint } from "./geocode";

describe("geocoding", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("parses PDOK WKT points (lon lat order)", () => {
    expect(parsePdokPoint("POINT(5.12142 52.09074)")).toEqual({ latitude: 52.09074, longitude: 5.12142, source: "pdok" });
    expect(parsePdokPoint("garbage")).toBeNull();
  });
  it("is off by default and never calls the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await geocode({ postalCode: "3511AA", city: "Utrecht" })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("queries PDOK with the given parts only and handles failures", async () => {
    vi.stubEnv("GEOCODING_PROVIDER", "pdok");
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ response: { docs: [{ centroide_ll: "POINT(4.9 52.37)" }] } }) });
    vi.stubGlobal("fetch", fetchSpy);
    expect(await geocode({ postalCode: "1012AB", city: "Amsterdam" })).toEqual({ latitude: 52.37, longitude: 4.9, source: "pdok" });
    expect(String(fetchSpy.mock.calls[0][0])).toContain("q=1012AB%20Amsterdam");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await geocode({ postalCode: "1012AB" })).toBeNull();
    expect(await geocode({ postalCode: "10115", country: "DE" })).toBeNull();
  });
});
