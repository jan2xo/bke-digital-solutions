import { createPublicKey, verify } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin, requireRecentAdmin } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { env } from "@/lib/env";
import { scanArtifact } from "@/lib/supply-chain/scanner";
import { resolveTrustedSupplyChainKey } from "@/lib/supply-chain/keyring";
import { signReleaseManifest } from "@/lib/supply-chain/signing";
import { buildReleaseManifest, canonicalizeManifest, manifestHash } from "@/lib/supply-chain/manifest";
import { downloadObject } from "@/lib/storage";

const schema = z.object({ versionId: z.string().min(1), action: z.enum(["SIGN", "RECORD_SCAN", "VERIFY_SIGNATURE"]).optional(), signature: z.string().min(16).optional(), signerKeyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).optional() });
function publicKey(keyId: string) { const resolved = resolveTrustedSupplyChainKey(env.SUPPLY_CHAIN_TRUSTED_KEYS, env.SUPPLY_CHAIN_SIGNING_KEY_ID, env.SUPPLY_CHAIN_SIGNING_PUBLIC_KEY, keyId); const raw = resolved.key.includes("BEGIN") ? resolved.key : Buffer.from(resolved.key, "base64").toString("utf8"); return createPublicKey(raw); }

export async function GET() { try { await requireAdmin(); return NextResponse.json(await db.supplyChainEvidence.findMany({ include: { verificationEvidence: true, version: { include: { product: { select: { name: true } }, artifacts: { select: { name: true, sha256: true, sizeBytes: true } } } } }, orderBy: { builtAt: "desc" } })); } catch (e) { return apiError(e); } }

export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const admin = await requireRecentAdmin();
    const limited = await rateLimit(`admin-supply-chain:${admin.id}:${clientIp(request)}`, 30, 3600); if (!limited.allowed) throw new Error("RATE_LIMITED");
    const input = schema.parse(await request.json());
    const existing = await db.supplyChainEvidence.findUnique({ where: { versionId: input.versionId }, include: { version: { include: { product: true, artifacts: true } }, verificationEvidence: true } });
    if (!existing) throw new Error("NOT_FOUND");
    const signedManifest = buildReleaseManifest({ productId: existing.version.productId, productSlug: existing.version.product.slug, versionId: existing.version.id, version: existing.version.version, signingKeyId: env.SUPPLY_CHAIN_SIGNING_KEY_ID, artifacts: existing.version.artifacts.map((a) => ({ id: a.id, objectKey: a.objectKey, sha256: a.sha256, sizeBytes: Number(a.sizeBytes), contentType: a.contentType })) });
    const canonicalPayloadHash = manifestHash(canonicalizeManifest(signedManifest));
    if (input.action === "SIGN") {
      const signed = signReleaseManifest({ productId: existing.version.productId, productSlug: existing.version.product.slug, versionId: existing.version.id, version: existing.version.version, artifacts: existing.version.artifacts.map((a) => ({ id: a.id, objectKey: a.objectKey, sha256: a.sha256, sizeBytes: Number(a.sizeBytes), contentType: a.contentType })) });
      const prior = existing.verificationEvidence.find((v) => v.kind === "SIGNATURE" && v.result === "VERIFIED" && v.artifactHash === signed.payloadHash && v.signerKeyId === signed.keyId);
      if (!prior) {
        await db.supplyChainVerificationEvidence.create({ data: { evidenceId: existing.id, kind: "SIGNATURE", artifactHash: signed.payloadHash, signerKeyId: signed.keyId, result: "VERIFIED", reference: signed.canonicalPayload, metadata: { algorithm: signed.algorithm, manifest: signed.manifest } } });
        await db.supplyChainEvidence.update({ where: { id: existing.id }, data: { canonicalPayloadHash: signed.payloadHash, signatureAlgorithm: signed.algorithm, signatureKeyId: signed.keyId, signedAt: new Date(), signatureVerified: true, manifestSignature: signed.signature, manifestJson: signed.manifest } });
      }
      await db.auditLog.create({ data: { actorId: admin.id, action: "SUPPLY_CHAIN_SIGNED", targetType: "SupplyChainEvidence", targetId: existing.id, metadata: { keyId: signed.keyId, payloadHash: signed.payloadHash } } });
      return NextResponse.json({ ok: true, status: "VERIFIED", keyId: signed.keyId, algorithm: signed.algorithm, payloadHash: signed.payloadHash });
    }
    if (input.action === "VERIFY_SIGNATURE") {
      if (!input.signature) throw new Error("SIGNATURE_REQUIRED"); const signerKeyId = input.signerKeyId ?? env.SUPPLY_CHAIN_SIGNING_KEY_ID;
      const valid = verify(null, Buffer.from(canonicalPayloadHash), publicKey(signerKeyId), Buffer.from(input.signature, "base64"));
      await db.supplyChainVerificationEvidence.create({ data: { evidenceId: existing.id, kind: "SIGNATURE", artifactHash: canonicalPayloadHash, signerKeyId, result: valid ? "VERIFIED" : "FAILED", failureReason: valid ? undefined : "SIGNATURE_MISMATCH", metadata: { algorithm: "Ed25519" } } });
      if (!valid) throw new Error("SIGNATURE_INVALID"); await db.supplyChainEvidence.update({ where: { id: existing.id }, data: { signatureVerified: true, manifestSignature: input.signature } });
    }
    if (input.action === "RECORD_SCAN") {
      const results = [];
      for (const artifact of existing.version.artifacts) {
        let scan;
        try { scan = await scanArtifact(await downloadObject(artifact.objectKey)); }
        catch (error) { scan = { scannerId: env.MALWARE_SCANNER_PROVIDER ?? "storage", scannerVersion: env.MALWARE_SCANNER_VERSION ?? "unknown", result: "FAILED" as const, failureReason: error instanceof Error ? "OBJECT_READ_FAILED" : "OBJECT_READ_FAILED" }; }
        results.push(scan);
        await db.supplyChainVerificationEvidence.create({ data: { evidenceId: existing.id, kind: "MALWARE_SCAN", artifactHash: canonicalPayloadHash, scannerId: scan.scannerId, scannerVersion: scan.scannerVersion, result: scan.result, reference: scan.reference, failureReason: scan.failureReason, metadata: { artifactId: artifact.id, objectKey: artifact.objectKey, artifactSha256: artifact.sha256 } } });
      }
      const aggregate = results.some((r) => r.result === "INFECTED") ? "INFECTED" : results.every((r) => r.result === "CLEAN") ? "CLEAN" : "FAILED";
      await db.supplyChainEvidence.update({ where: { id: existing.id }, data: { malwareStatus: aggregate } }); if (aggregate !== "CLEAN") throw new Error("MALWARE_SCAN_NOT_CLEAN");
    }
    await db.auditLog.create({ data: { actorId: admin.id, action: "SUPPLY_CHAIN_EVIDENCE_UPDATED", targetType: "SupplyChainEvidence", targetId: existing.id, metadata: { action: input.action } } }); return NextResponse.json({ ok: true });
  } catch (e) { return apiError(e); }
}
