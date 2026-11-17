import { describe, expect, it } from "vitest";
import { detectUploadType } from "./detect";

describe("upload type detection", () => {
  it("accepts PDF, JPEG, PNG and WebP by signature", () => {
    expect(detectUploadType(new TextEncoder().encode("%PDF-1.4"))).toBe("application/pdf");
    expect(detectUploadType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectUploadType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectUploadType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });
  it("rejects HTML, SVG and executables even if renamed", () => {
    expect(detectUploadType(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(detectUploadType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(detectUploadType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
  });
});
