import { afterAll, describe, expect, it, vi } from "vitest";
import { createServer, type AddressInfo } from "node:net";
vi.mock("server-only", () => ({}));
import { parseClamdReply, scanBytes } from "./scan";

/** Minimal clamd stand-in speaking the INSTREAM protocol. */
const received: Buffer[] = [];
const server = createServer((sock) => {
  let buf = Buffer.alloc(0);
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    if (buf.length >= 4 && buf.subarray(buf.length - 4).equals(Buffer.alloc(4))) {
      received.push(buf);
      sock.end(buf.includes(Buffer.from("EICAR")) ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
    }
  });
});
const port = await new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as AddressInfo).port)));
afterAll(() => server.close());

describe("malware scanning", () => {
  it("reports not_scanned without a configured scanner", async () => {
    expect(await scanBytes(new Uint8Array([1, 2, 3]), { host: "" })).toEqual({ status: "not_scanned" });
  });
  it("streams the file with length-prefixed chunks and parses clean and infected replies", async () => {
    expect(await scanBytes(new TextEncoder().encode("%PDF-1.4 hello"), { host: "127.0.0.1", port })).toEqual({ status: "clean", engine: "clamav" });
    expect(received.at(-1)!.subarray(0, 10).toString()).toBe("zINSTREAM\0");
    expect(await scanBytes(new TextEncoder().encode("X5O!P%@AP EICAR test"), { host: "127.0.0.1", port })).toEqual({ status: "infected", signature: "Eicar-Test-Signature" });
  });
  it("treats an unreachable scanner or odd replies as errors", async () => {
    expect((await scanBytes(new Uint8Array([1]), { host: "127.0.0.1", port: 1, timeoutMs: 2000 })).status).toBe("error");
    expect(parseClamdReply("INSTREAM size limit exceeded. ERROR").status).toBe("error");
  });
});
