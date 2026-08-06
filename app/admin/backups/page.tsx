import { db } from "@/lib/db";
import { BackupActions, CreateBackupActions } from "@/components/backups/admin-backup-actions";

const when = (date: Date | null) => date ? date.toLocaleString() : "—";
const size = (bytes: bigint) => new Intl.NumberFormat("en", { style: "unit", unit: "megabyte", maximumFractionDigits: 2 }).format(Number(bytes) / 1_048_576);

export default async function BackupsPage() {
  const [backups, restores] = await Promise.all([
    db.backupArchive.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    db.backupOperation.findMany({ where: { type: { in: ["SIMULATE_RESTORE", "RESTORE_ISOLATED"] } }, orderBy: { createdAt: "desc" }, take: 25 }),
  ]);
  return <main className="shell py-10"><div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-4xl font-black">Backups</h1><p className="mt-2 text-muted">Encrypted recovery archives and isolated restore evidence. Secrets and Valkey cache are never included.</p></div><CreateBackupActions/></div>
    <section className="mt-8 overflow-x-auto card"><table className="w-full text-left text-sm"><thead><tr><th>Created</th><th>Status</th><th>Tier</th><th>Size</th><th>Duration</th><th>Objects</th><th>Checksum</th><th>Verified</th><th>Expires</th><th>Actions</th></tr></thead><tbody>{backups.map((backup) => <tr className="border-t" key={backup.id}><td>{when(backup.createdAt)}</td><td>{backup.status}{backup.errorCode ? ` · ${backup.errorCode}` : ""}</td><td>{backup.retentionTier}</td><td>{size(backup.sizeBytes)}</td><td>{backup.durationMs == null ? "—" : `${backup.durationMs} ms`}</td><td>{backup.objectCount}{backup.missingObjectCount ? ` (${backup.missingObjectCount} missing)` : ""}</td><td className="font-mono">{backup.manifestChecksum?.slice(0, 12) ?? "—"}</td><td>{when(backup.verifiedAt)}</td><td>{when(backup.expiresAt)}</td><td><BackupActions id={backup.id} expired={backup.status === "EXPIRED"}/></td></tr>)}</tbody></table>{backups.length === 0 && <p className="p-5 text-muted">No backup history yet.</p>}</section>
    <section className="mt-10"><h2 className="text-2xl font-black">Restore history</h2><div className="mt-4 overflow-x-auto card"><table className="w-full text-left text-sm"><thead><tr><th>Requested</th><th>Backup</th><th>Mode</th><th>Status</th><th>Duration</th><th>Error</th></tr></thead><tbody>{restores.map((operation) => <tr className="border-t" key={operation.id}><td>{when(operation.createdAt)}</td><td className="font-mono">{operation.backupId}</td><td>{operation.type}</td><td>{operation.status}</td><td>{operation.durationMs == null ? "—" : `${operation.durationMs} ms`}</td><td>{operation.errorCode ?? "—"}</td></tr>)}</tbody></table>{restores.length === 0 && <p className="p-5 text-muted">No restore operations yet.</p>}</div></section>
  </main>;
}
