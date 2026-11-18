import "server-only";
import { connect } from "node:net";

export type ScanResult =
  | { status: "clean"; engine: string }
  | { status: "infected"; signature: string }
  | { status: "not_scanned" }
  | { status: "error"; error: string };

/**
 * ClamAV (clamd) INSTREAM scan over TCP. Configure CLAMAV_HOST (and optionally
 * CLAMAV_PORT, default 3310). Without it, uploads are stored as `not_scanned`
 * and shown as such to verifiers — never reported as clean.
 */
export async function scanBytes(bytes: Uint8Array, opts: { host?: string; port?: number; timeoutMs?: number } = {}): Promise<ScanResult> {
  const host = opts.host ?? process.env.CLAMAV_HOST;
  if (!host) return { status: "not_scanned" };
  const port = opts.port ?? Number(process.env.CLAMAV_PORT ?? 3310);
  return new Promise((resolve) => {
    let reply = "";
    let settled = false;
    const done = (r: ScanResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(r);
    };
    const socket = connect({ host, port });
    socket.setTimeout(opts.timeoutMs ?? 15_000, () => done({ status: "error", error: "Scanner timed out" }));
    socket.on("error", (e) => done({ status: "error", error: e.message }));
    socket.on("data", (d) => { reply += d.toString("utf8"); });
    socket.on("end", () => done(parseClamdReply(reply)));
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const CHUNK = 64 * 1024;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        const part = bytes.subarray(i, i + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(part.length, 0);
        socket.write(len);
        socket.write(part);
      }
      socket.write(Buffer.alloc(4)); // zero-length chunk terminates the stream
    });
  });
}

export function parseClamdReply(raw: string): ScanResult {
  const line = raw.replace(/\0/g, "").trim();
  if (/:\s*OK$/.test(line)) return { status: "clean", engine: "clamav" };
  const found = line.match(/:\s*(.+)\s+FOUND$/);
  if (found) return { status: "infected", signature: found[1] };
  return { status: "error", error: line || "Empty scanner reply" };
}
