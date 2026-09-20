import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const encryptedArtifactSchema = z.object({
  sourceKey: z.string().min(1),
  backupKey: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  encryptedSizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  encryptedSha256: z.string().regex(/^[a-f0-9]{64}$/),
  iv: z.string().min(16),
  authTag: z.string().min(16),
});

export const backupManifestSchema = z.object({
  formatVersion: z.literal(1),
  backupId: z.string().min(1),
  deploymentId: z.string().min(1),
  createdAt: z.iso.datetime(),
  retentionTier: z.enum(["MANUAL", "DAILY", "WEEKLY", "MONTHLY"]),
  database: encryptedArtifactSchema,
  objects: z.array(encryptedArtifactSchema),
  missingSourceObjects: z.array(z.string()),
  migrations: z.array(z.string()),
  tableCounts: z.record(z.string(), z.number().int().nonnegative()),
  runtime: z.object({
    nodeVersion: z.string(),
    paymentProvider: z.string(),
    emailProvider: z.string(),
    providerConfigSource: z.string(),
    sourceBucket: z.string(),
  }),
});

export type BackupManifest = z.infer<typeof backupManifestSchema>;

export function sha256(input: Uint8Array | string) {
  return createHash("sha256").update(input).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function encryptBuffer(input: Uint8Array, key: Buffer) {
  if (key.length !== 32) throw new Error("INVALID_BACKUP_ENCRYPTION_KEY");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
  return { encrypted, iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

export function decryptBuffer(input: Uint8Array, key: Buffer, iv: string, authTag: string) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([decipher.update(input), decipher.final()]);
}

export function missingObjects(expected: Iterable<string>, actual: Iterable<string>) {
  const available = new Set(actual);
  return [...new Set(expected)].filter((key) => !available.has(key)).sort();
}

export function verifyManifest(input: unknown, manifestChecksum?: string) {
  const manifest = backupManifestSchema.parse(input);
  const checksum = sha256(canonicalJson(manifest));
  return { manifest, checksum, checksumMatches: !manifestChecksum || checksum === manifestChecksum };
}
