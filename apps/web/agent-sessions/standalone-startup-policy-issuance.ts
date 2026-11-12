import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";
import { verifyStandaloneStartupInstallAttestationInTransaction } from
  "./standalone-startup-install-attestation";
import { signStandaloneStartupPolicyInTransaction } from
  "./account-product-lease-signer";
import { productActivationModes, type ProductActivationMode } from
  "@/apps/web/licensing/product-activation-mode";

// This is the original certified account-product public issuer provenance,
// not a claim that DS main or the Agent installed trust bundle was repinned.
const PINNED_ISSUER_SOURCE = "09c16bc5c7e1d6ab3cb8df0ba569e6da05498f3f";
const ENVELOPE_SCHEMA = "bke.standalone-startup-envelope.v1";
const POLICY_SCHEMA = "bke.standalone-startup-policy.v1";
const MAX_POLICY_AGE_MS = 60 * 60_000;

type SqlProductMode = Readonly<{
  productId: string;
  version: string;
  activationMode: string;
}>;

function dotnetUtc(value: Date): string {
  // DateTimeOffset.ToString("O") as verified by Agent .NET consumer:
  // exactly seven fractional digits and an explicit +00:00 offset, not Z.
  return value.toISOString().slice(0, -1) + "0000+00:00";
}

export type IssuedStandaloneStartupPolicy = Readonly<{
  status: "issued";
  envelope: string;
  kid: string;
  productId: string;
  mode: ProductActivationMode;
  expiresAt: string;
}>;

/**
 * Private, source-only authority. Caller must hold one SERIALIZABLE
 * transaction; signature, nonce burn and audit commit together. Nothing
 * signed is delivered until the outer transaction commits.
 *
 * Machine identity is NOT taken from a product form: it is verified from an
 * independently registered, fresh Ed25519 Agent installer attestation.
 * Exactly one published SQL ProductActivationPolicy row supplies mode.
 * This is install policy, NOT an account or commercial entitlement.
 */
export async function prepareAndSignStandaloneStartupPolicyInTransaction(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    signedAgentInstallAttestation: string;
    keyset: string | undefined;
  }>,
  now = new Date(),
): Promise<IssuedStandaloneStartupPolicy> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error("STARTUP_POLICY_CLOCK_INVALID");

  const attested = await verifyStandaloneStartupInstallAttestationInTransaction(
    tx, input.signedAgentInstallAttestation, now);

  const rows = await tx.$queryRaw<SqlProductMode[]>`
    SELECT p."productId" AS "productId", pv."version" AS "version",
           policy."activationMode" AS "activationMode"
      FROM "Product" p
      JOIN "ProductActivationPolicy" policy ON policy."productId" = p."id"
      JOIN "ProductVersion" pv ON pv."productId" = p."id"
     WHERE p."productId" = ${attested.productId}
       AND pv."version" = ${attested.version}
       AND p."active" = TRUE AND p."publishedAt" IS NOT NULL
       AND p."archivedAt" IS NULL AND p."launcherExecutionType" = 'STANDALONE'
       AND policy."publishedEver" = TRUE
       AND pv."active" = TRUE AND pv."publishedAt" IS NOT NULL
       AND pv."lifecycle" IN ('STABLE','LTS')
       AND LOWER(pv."operatingSystem") = 'windows'
       AND LOWER(pv."architecture") IN ('x64','x86_64','amd64')
     LIMIT 2 FOR SHARE OF p, policy, pv
  `;
  if (rows.length !== 1 ||
      rows[0]!.productId !== attested.productId ||
      rows[0]!.version !== attested.version ||
      !productActivationModes.includes(
        rows[0]!.activationMode as ProductActivationMode))
    throw new Error("STARTUP_POLICY_SQL_MODE_OR_RELEASE_UNAVAILABLE");
  const mode = rows[0]!.activationMode as ProductActivationMode;

  // Unique SQL primary key, not an in-memory nonce cache. Fail closed on
  // replay across requests, transactions and service restarts.
  const consumed = await tx.$queryRaw<Array<{ attestationId: string }>>`
    INSERT INTO "AgentStartupAttestationReceipt"
      ("attestationId","signerKid","productId","version",
       "installationId","imageSha256","attestationSha256","consumedAt")
    VALUES (
      ${attested.attestationId}::uuid, ${attested.signerKid},
      ${attested.productId}, ${attested.version},
      ${attested.installationId}::uuid, ${attested.imageSha256},
      ${attested.attestationSha256}, ${now}
    )
    ON CONFLICT ("attestationId") DO NOTHING
    RETURNING "attestationId"::text AS "attestationId"
  `;
  if (consumed.length !== 1 || consumed[0]!.attestationId !== attested.attestationId)
    throw new Error("STARTUP_POLICY_ATTESTATION_REPLAY");

  const expires = new Date(now.getTime() + MAX_POLICY_AGE_MS);
  const payload = JSON.stringify({
    schema: POLICY_SCHEMA,
    issuer_source_sha: PINNED_ISSUER_SOURCE,
    product_id: attested.productId,
    version: attested.version,
    installation_id: attested.installationId,
    image_path: attested.imagePath,
    image_sha256: attested.imageSha256,
    allowed_user_sid: attested.allowedUserSid,
    activation_mode: mode,
    not_before: dotnetUtc(now),
    expires_at: dotnetUtc(expires),
  });

  const signed = await signStandaloneStartupPolicyInTransaction(
    tx, payload, input.keyset);
  const envelope = JSON.stringify({
    schema: ENVELOPE_SCHEMA,
    kid: signed.kid,
    payload,
    signature: signed.signature,
  });
  if (envelope.length > 16_384)
    throw new Error("STARTUP_POLICY_ENVELOPE_TOO_LARGE");

  const policySha256 = createHash("sha256").update(envelope).digest("hex");
  await tx.auditLog.create({
    data: {
      action: "AGENT_STANDALONE_STARTUP_POLICY_ISSUED",
      targetType: "AgentStandaloneStartupPolicy",
      targetId: attested.attestationId,
      metadata: {
        schema: "bke.standalone-startup-issuance-audit.v1",
        kid: signed.kid,
        attestationKid: attested.signerKid,
        productId: attested.productId,
        productVersion: attested.version,
        activationMode: mode,
        attestationSha256: attested.attestationSha256,
        policySha256,
        expiresAt: dotnetUtc(expires),
      },
    },
  });

  return Object.freeze({
    status: "issued" as const,
    envelope,
    kid: signed.kid,
    productId: attested.productId,
    mode,
    expiresAt: dotnetUtc(expires),
  });
}

/**
 * Deliberately NO HTTP route. This server-only operation is disabled by
 * default even in preproduction. Real Agent attestation key enrollment and
 * authenticated issuance transport are separate certification intents.
 * Production remains blocked regardless of the flag's value.
 */
export async function issueStandaloneStartupPolicyPreproduction(
  signedAgentInstallAttestation: string,
) {
  if (process.env.DEPLOYMENT_ENV === "production")
    throw new Error("STARTUP_POLICY_PRODUCTION_LOCK");
  const runtime = getRuntimeEnvironment();
  if (runtime.DEPLOYMENT_ENV === "production" ||
      !runtime.STANDALONE_STARTUP_POLICY_ISSUANCE_ENABLED ||
      !runtime.ACCOUNT_PRODUCT_LEASE_SIGNING_KEYS_JSON)
    throw new Error("STARTUP_POLICY_ISSUER_DISABLED");

  return db.$transaction(
    tx => prepareAndSignStandaloneStartupPolicyInTransaction(tx, {
      signedAgentInstallAttestation,
      keyset: runtime.ACCOUNT_PRODUCT_LEASE_SIGNING_KEYS_JSON,
    }),
    { isolationLevel: "Serializable", timeout: 10_000 },
  );
}
