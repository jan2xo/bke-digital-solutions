import { db } from "@/lib/db";
import { getRuntimeEnvironment } from "@/lib/env";
import { scannerHealth } from "@/lib/supply-chain/scanner";
export const dynamic = "force-dynamic";
export default async function ScannerPage() {
  const runtime = getRuntimeEnvironment();
  const last = await db.supplyChainVerificationEvidence.findFirst({ where: { kind: "MALWARE_SCAN", result: "CLEAN" }, orderBy: { verifiedAt: "desc" }, select: { verifiedAt: true, scannerVersion: true } });
  const status = await scannerHealth();
  return <main className="shell py-10"><h1 className="text-4xl font-black">Malware scanner</h1><p className="mt-2 text-slate-600">Operational visibility only. Scanner lifecycle remains deployment-level.</p><div className="card mt-8 grid gap-2 p-6"><p><strong>Provider:</strong> {runtime.MALWARE_SCANNER_PROVIDER ?? "unknown"}</p><p><strong>Status:</strong> {status}</p><p><strong>Version:</strong> {last?.scannerVersion ?? runtime.MALWARE_SCANNER_VERSION ?? "unknown"}</p><p><strong>Last successful scan:</strong> {last?.verifiedAt.toLocaleString() ?? "—"}</p></div></main>;
}
