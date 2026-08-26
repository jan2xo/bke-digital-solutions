import { createPrivateKey, sign } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getRuntimeEnvironment } from "@/lib/env";
import { parseLeaseEnvelope, leasePayloadSchema, requireCloudAgentVersion } from "@/lib/licensing/cloud-agent-contract";
import { verifySignedLease } from "@/lib/licensing-agent";
import { activeCommercialSigningKey, ensureCommercialSigningKey } from "@/lib/licensing/signing-registry";
import { resolveAgentUpdateRelease } from "@/lib/releases/resolution";
import { clientIp, readLimitedBody } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { hashToken, randomToken } from "@/lib/security/crypto";
import { requireManifestArtifact, verifySignedEnvelope } from "@/lib/supply-chain/manifest";

const requestSchema = z.object({
  lease: z.unknown(),
  product_id: z.string().min(1).max(128),
  current_version: z.string().min(1).max(64),
  platform: z.string().min(1).max(64),
  architecture: z.string().min(1).max(64),
  channel: z.enum(["stable", "lts"]),
}).strict();

function canonical(value: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function error(code: string, status: number) {
  return NextResponse.json({ error: code }, { status });
}

export async function POST(request: Request) {
  try {
    requireCloudAgentVersion(request);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return error("INVALID_CONTENT_TYPE", 415);
    const input = requestSchema.parse(JSON.parse((await readLimitedBody(request, 32_768)).toString("utf8")));
    if (!(await rateLimit(`agent-update:${clientIp(request)}:${input.product_id}`, 60, 3600)).allowed) return error("RATE_LIMITED", 429);

    const lease = parseLeaseEnvelope(input.lease);
    if (!verifySignedLease(lease)) return error("INVALID_LEASE", 403);
    const payload = leasePayloadSchema.parse(JSON.parse(lease.payload));
    if (payload.product_id !== input.product_id || payload.version !== input.current_version || payload.revoked || new Date(payload.not_before) > new Date() || new Date(payload.expires_at) <= new Date()) return error("INVALID_LEASE_CONTEXT", 403);
    const record = await db.licenseLeaseRecord.findUnique({ where: { leaseId: payload.lease_id }, include: { license: { include: { account: true, edition: true, subscription: true } } } });
    if (!record || record.leasePayload !== lease.payload || record.leaseSignature !== lease.signature || record.signerKeyId !== lease.key_id || record.status !== "ACTIVE" || record.supersededById || record.license.status !== "ACTIVE" || record.license.account.lifecycleState !== "ACTIVE" || (record.license.expiresAt && record.license.expiresAt <= new Date())) return error("UPDATE_NOT_ENTITLED", 403);

    const updatePolicy = record.license.edition?.updatePolicy ?? "LIFETIME";
    if (updatePolicy === "ACTIVE_TERM" && (!record.license.expiresAt || record.license.expiresAt <= new Date() || record.license.subscription?.status !== "ACTIVE")) return error("UPDATE_NOT_ENTITLED", 403);
    const release = await resolveAgentUpdateRelease({ canonicalProductId: input.product_id, currentVersion: input.current_version, platform: input.platform, architecture: input.architecture, channel: input.channel, sameMajorOnly: updatePolicy === "MAJOR_VERSION" });
    if (!release) return NextResponse.json({ status: "up_to_date" });
    const artifact = release.artifacts[0]!;
    const evidence = release.supplyChainEvidence;
    if (!evidence?.manifestSignature || !evidence.signatureKeyId || evidence.signatureAlgorithm !== "Ed25519") return error("RELEASE_NOT_VERIFIED", 503);
    const runtime = getRuntimeEnvironment();
    const verifiedEnvelope = verifySignedEnvelope(
      { algorithm: "Ed25519", keyId: evidence.signatureKeyId, manifest: evidence.manifestJson, signature: evidence.manifestSignature },
      runtime.SUPPLY_CHAIN_TRUSTED_KEYS, runtime.SUPPLY_CHAIN_SIGNING_KEY_ID, runtime.SUPPLY_CHAIN_SIGNING_PUBLIC_KEY,
      { productId: release.productId, productSlug: release.product.slug, versionId: release.id, version: release.version },
    );
    requireManifestArtifact(verifiedEnvelope.manifest, {
      id: artifact.id, objectKey: artifact.objectKey, sha256: artifact.sha256,
      sizeBytes: Number(artifact.sizeBytes), contentType: artifact.contentType,
    });

    await ensureCommercialSigningKey();
    const signingKey = await activeCommercialSigningKey();
    const policy = {
      schema: "bke.update-policy.v1", product_id: input.product_id, current_version: input.current_version,
      latest_version: release.version, minimum_supported_version: input.current_version, channel: input.channel,
      platform: release.operatingSystem, architecture: release.architecture, release_id: release.id,
      artifact_id: artifact.id, artifact_sha256: artifact.sha256.toLowerCase(), artifact_size: Number(artifact.sizeBytes),
      content_type: artifact.contentType, published_at: release.publishedAt!.toISOString(), issued_at: release.releasedAt.toISOString(),
      revision: release.releasedAt.getTime(), signing_key_id: signingKey.keyId, algorithm: "Ed25519",
    };
    if (!/^[a-f0-9]{64}$/.test(policy.artifact_sha256) || !Number.isSafeInteger(policy.artifact_size) || policy.artifact_size < 0) return error("INVALID_ARTIFACT_CONTRACT", 503);
    const signature = sign(null, Buffer.from(canonical(policy)), createPrivateKey(signingKey.privateKey)).toString("base64");
    const token = randomToken();
    await db.downloadGrant.create({ data: { licenseId: record.licenseId, artifactId: artifact.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60_000) } });
    return NextResponse.json({ status: "update_available", policy: { ...policy, signature }, download_url: new URL(`/api/downloads/grants/${token}`, runtime.APP_URL).toString() });
  } catch (cause) {
    if (cause instanceof z.ZodError || cause instanceof SyntaxError) return error("INVALID_REQUEST", 400);
    return error("UPDATE_DISCOVERY_FAILED", 500);
  }
}
