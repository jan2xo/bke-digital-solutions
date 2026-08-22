import { createHash } from "node:crypto";
import { headObject, streamObject } from "@/lib/storage";
import { scanArtifactStream, type MalwareScanResult } from "@/lib/supply-chain/scanner";

export async function verifyStoredArtifact(input: { objectKey: string; expectedSize: number; expectedSha256?: string | null; contentType: string }) {
  const head = await headObject(input.objectKey);
  if (head.ContentLength !== input.expectedSize) throw new Error("UPLOAD_SIZE_MISMATCH");
  if (head.ContentType && head.ContentType !== input.contentType) throw new Error("UPLOAD_CONTENT_TYPE_MISMATCH");
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const malware: MalwareScanResult = await scanArtifactStream(await streamObject(input.objectKey), input.expectedSize, (chunk) => { sizeBytes += chunk.byteLength; hash.update(chunk); });
  if (sizeBytes !== input.expectedSize) throw new Error("UPLOAD_SIZE_MISMATCH");
  const sha256 = hash.digest("hex");
  if (input.expectedSha256 && input.expectedSha256.toLowerCase() !== sha256) throw new Error("UPLOAD_HASH_MISMATCH");
  if (malware.result !== "CLEAN") throw new Error(malware.failureReason ?? "MALWARE_SCAN_FAILED");
  return { sha256, sizeBytes: input.expectedSize, contentType: head.ContentType ?? input.contentType, malware };
}
