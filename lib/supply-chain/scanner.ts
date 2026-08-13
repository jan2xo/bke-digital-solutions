import "server-only";
import net from "node:net";
import { env, getRuntimeEnvironment } from "@/lib/env";

export type MalwareScanResult = {
  scannerId: string;
  scannerVersion: string;
  result: "CLEAN" | "INFECTED" | "FAILED";
  reference?: string;
  failureReason?: string;
};

function failed(scannerId: string, reason: string): MalwareScanResult {
  return { scannerId, scannerVersion: env.MALWARE_SCANNER_VERSION ?? "unknown", result: "FAILED", failureReason: reason };
}

function clamScan(bytes: Uint8Array): Promise<MalwareScanResult> {
  const runtime = getRuntimeEnvironment();
  const host = runtime.MALWARE_SCANNER_HOST;
  if (!host) return Promise.resolve(failed("clamav", "SCANNER_NOT_CONFIGURED"));
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: runtime.MALWARE_SCANNER_PORT });
    const timer = setTimeout(() => { socket.destroy(); resolve(failed("clamav", "SCANNER_TIMEOUT")); }, runtime.MALWARE_SCANNER_TIMEOUT_MS);
    let output = "";
    let settled = false;
    const finish = (result: MalwareScanResult) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); resolve(result); };
    socket.on("connect", () => {
      // ClamAV INSTREAM protocol: command, length-prefixed chunks, terminating zero chunk.
      socket.write(Buffer.from("zINSTREAM\0"));
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        const chunk = Buffer.from(bytes.slice(offset, Math.min(offset + chunkSize, bytes.byteLength)));
        const length = Buffer.allocUnsafe(4); length.writeUInt32BE(chunk.length); socket.write(length); socket.write(chunk);
      }
      const end = Buffer.alloc(4); socket.write(end);
    });
    socket.on("data", (data) => {
      output += data.toString("utf8");
      if (!output.includes("\0") && !output.includes("\n")) return;
      const reference = output.replaceAll("\0", "").trim();
      if (/FOUND/i.test(output)) finish({ scannerId: "clamav", scannerVersion: runtime.MALWARE_SCANNER_VERSION ?? "configured", result: "INFECTED", reference });
      else if (/OK/i.test(output)) finish({ scannerId: "clamav", scannerVersion: runtime.MALWARE_SCANNER_VERSION ?? "configured", result: "CLEAN", reference });
      else finish(failed("clamav", "MALFORMED_SCANNER_RESPONSE"));
    });
    socket.on("error", () => finish(failed("clamav", "SCANNER_UNAVAILABLE")));
    socket.on("close", () => { if (!settled) finish(failed("clamav", "SCANNER_ERROR")); });
  });
}

export async function scanArtifact(bytes: Uint8Array): Promise<MalwareScanResult> {
  const runtime = getRuntimeEnvironment();
  const scanner = runtime;
  if (bytes.byteLength > scanner.MALWARE_SCANNER_MAX_BYTES) return failed(scanner.MALWARE_SCANNER_PROVIDER ?? "unconfigured", "ARTIFACT_TOO_LARGE");
  const provider = scanner.MALWARE_SCANNER_PROVIDER ?? "";
  if (!provider) return failed("unconfigured", "SCANNER_NOT_CONFIGURED");
  if (provider === "deterministic-test") {
    if (env.NODE_ENV !== "test") return failed(provider, "TEST_SCANNER_FORBIDDEN");
    const text = Buffer.from(bytes).toString("ascii");
    return text.includes("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*")
      ? { scannerId: provider, scannerVersion: "1", result: "INFECTED", reference: "deterministic-eicar" }
      : { scannerId: provider, scannerVersion: "1", result: "CLEAN", reference: "deterministic-test" };
  }
  if (provider === "clamav") return clamScan(bytes);
  return failed(provider, "SCANNER_ADAPTER_NOT_IMPLEMENTED");
}

export async function scannerHealth(): Promise<"HEALTHY" | "UNAVAILABLE" | "UNKNOWN"> { const runtime = getRuntimeEnvironment(); if (runtime.MALWARE_SCANNER_PROVIDER !== "clamav" || !runtime.MALWARE_SCANNER_HOST) return "UNKNOWN"; return new Promise((resolve) => { const socket = net.createConnection({ host: runtime.MALWARE_SCANNER_HOST, port: runtime.MALWARE_SCANNER_PORT }); const timer = setTimeout(() => { socket.destroy(); resolve("UNAVAILABLE"); }, Math.min(runtime.MALWARE_SCANNER_TIMEOUT_MS, 3000)); socket.once("connect", () => socket.write("zPING\0")); socket.on("data", (chunk) => { clearTimeout(timer); socket.destroy(); resolve(chunk.toString().includes("PONG") ? "HEALTHY" : "UNAVAILABLE"); }); socket.on("error", () => { clearTimeout(timer); resolve("UNAVAILABLE"); }); }); }
