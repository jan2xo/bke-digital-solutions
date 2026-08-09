import "server-only";
import { env } from "@/lib/env";
export type MalwareScanResult = { scannerId: string; scannerVersion: string; result: "CLEAN" | "INFECTED" | "FAILED"; reference?: string; failureReason?: string };
export async function scanArtifact(_artifactHash: string): Promise<MalwareScanResult> {
  const provider = process.env.MALWARE_SCANNER_PROVIDER ?? "";
  if (!provider) return { scannerId: "unconfigured", scannerVersion: "unknown", result: "FAILED", failureReason: "SCANNER_NOT_CONFIGURED" };
  if (provider === "deterministic-test" && env.NODE_ENV !== "test") return { scannerId: provider, scannerVersion: "blocked", result: "FAILED", failureReason: "TEST_SCANNER_FORBIDDEN" };
  if (provider === "deterministic-test") return { scannerId: provider, scannerVersion: "1", result: "CLEAN", reference: "deterministic-test" };
  return { scannerId: provider, scannerVersion: process.env.MALWARE_SCANNER_VERSION ?? "configured", result: "FAILED", failureReason: "SCANNER_ADAPTER_NOT_IMPLEMENTED" };
}
