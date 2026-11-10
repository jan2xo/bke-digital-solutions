import { createHash } from "node:crypto";
import { missingObjects } from "@/lib/backups/integrity";

/** Stable, opaque archive path: source S3 object keys are never treated as filesystem paths. */
export function encryptedObjectKey(storagePrefix: string, sourceKey: string): string {
  if (!storagePrefix || !sourceKey) throw new Error("BACKUP_OBJECT_KEY_INVALID");
  const hash = createHash("sha256").update(sourceKey).digest("hex");
  return storagePrefix + "/objects/" + hash + ".enc";
}

/** Inventory must be comprehensive: database references are not allowed to disappear silently. */
export function reconcileSourceObjects(listed: readonly string[], referenced: readonly string[]) {
  if (listed.some((key) => !key || key.includes("\0")) ||
      referenced.some((key) => !key || key.includes("\0"))) {
    throw new Error("BACKUP_OBJECT_KEY_INVALID");
  }
  const unique = [...new Set(listed)].sort();
  if (listed.length !== unique.length) throw new Error("BACKUP_OBJECT_LIST_DUPLICATE");
  return { sourceKeys: unique, missingKeys: missingObjects(referenced, unique) };
}

export interface IsolatedRestoreTargets {
  readonly sourceDatabaseUrl: string;
  readonly targetDatabaseUrl: string;
  readonly sourceBucket: string;
  readonly backupBucket: string;
  readonly targetBucket: string;
  readonly sourceAccessKeyId?: string;
  readonly backupAccessKeyId?: string;
  readonly targetAccessKeyId?: string;
  /** Production requires an entirely separate database endpoint and distinct object credentials. */
  readonly production: boolean;
}

function database(url: string): { host: string; name: string } {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("RESTORE_DATABASE_URL_INVALID"); }
  if (!["postgresql:", "postgres:"].includes(parsed.protocol) || !parsed.hostname ||
      !parsed.pathname || parsed.pathname === "/") {
    throw new Error("RESTORE_DATABASE_URL_INVALID");
  }
  return {
    host: `${parsed.hostname.toLowerCase()}:${parsed.port || "5432"}`,
    name: decodeURIComponent(parsed.pathname.slice(1)).toLowerCase(),
  };
}

/** No operation may use a production-equivalent target, even with a different password. */
export function assertIsolatedRestoreTargets(targets: IsolatedRestoreTargets): void {
  const source = database(targets.sourceDatabaseUrl);
  const target = database(targets.targetDatabaseUrl);
  if (source.host === target.host && source.name === target.name ||
      target.name === "bke_production" || target.name === "production" ||
      target.name.startsWith("bke-production")) {
    throw new Error("RESTORE_TARGET_NOT_ISOLATED");
  }
  if (!targets.sourceBucket || !targets.backupBucket || !targets.targetBucket ||
      new Set([targets.sourceBucket, targets.backupBucket, targets.targetBucket]).size !== 3) {
    throw new Error("RESTORE_BUCKET_NOT_ISOLATED");
  }
  if (targets.production) {
    if (source.host === target.host) throw new Error("RESTORE_DATABASE_HOST_NOT_ISOLATED");
    if (!targets.sourceAccessKeyId || !targets.backupAccessKeyId || !targets.targetAccessKeyId ||
        targets.targetAccessKeyId === targets.sourceAccessKeyId ||
        targets.targetAccessKeyId === targets.backupAccessKeyId) {
      throw new Error("RESTORE_CREDENTIALS_NOT_ISOLATED");
    }
  }
}
