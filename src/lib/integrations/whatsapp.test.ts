import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { whatsappPayload } from "./whatsapp";

describe("WhatsApp payloads", () => {
  it("uses the approved template with title and details as body variables", () => {
    const p = whatsappPayload("31612345678", "Shift reminder", "Starts Mon 08:00  https://app/x", { name: "shift_update", language: "nl" });
    expect(p).toMatchObject({ type: "template", template: { name: "shift_update", language: { code: "nl" } } });
    expect((p as { template: { components: { parameters: { text: string }[] }[] } }).template.components[0].parameters.map((x) => x.text)).toEqual(["Shift reminder", "Starts Mon 08:00 https://app/x"]);
  });
  it("falls back to a text message without a template", () => {
    expect(whatsappPayload("31612345678", "Title", "Body")).toEqual({ messaging_product: "whatsapp", to: "31612345678", type: "text", text: { body: "Title\nBody" } });
  });
});
