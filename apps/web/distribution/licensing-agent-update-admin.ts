import "server-only";

import { randomUUID } from "node:crypto";
import { gt, lte, rcompare, valid } from "semver";
import type { PoolClient } from "pg";
import { auditInTransaction } from "@/apps/web/audit";
import { getPostgresPool } from "@/apps/web/persistence/postgres";
import {
  assertLicensingAgentSigningMaterial,
  inspectLicensingAgentGitHubRelease,
} from "@/platform/distribution/licensing-agent-update-contract";
import {
  licensingAgentUpdateAudience,
  licensingAgentUpdateKeyReference,
  resolveLicensingAgentUpdatePrivateKey,
} from "./licensing-agent-update-authority";

type JsonObject = Readonly<Record<string, unknown>>;
type OperationRow = Readonly<{ action: string; metadata: unknown }>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function mutation<T extends JsonObject>(
  actorId: string,
  operationId: string,
  action: string,
  request: JsonObject,
  execute: (transaction: PoolClient) => Promise<T>,
): Promise<T> {
  const transaction = await getPostgresPool().connect();
  try {
    await transaction.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await transaction.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [operationId],
    );
    const existing = (
      await transaction.query<OperationRow>(
        `SELECT "action", "metadata"
           FROM "LicensingAgentUpdateOperation"
          WHERE "operationId" = $1
          FOR UPDATE`,
        [operationId],
      )
    ).rows[0];

    if (existing) {
      const metadata = existing.metadata as { request?: unknown; result?: T };
      if (
        existing.action !== action ||
        canonical(metadata.request) !== canonical(request) ||
        !metadata.result
      ) {
        throw new Error("AGENT_UPDATE_OPERATION_REPLAY_MISMATCH");
      }
      await transaction.query("COMMIT");
      return metadata.result;
    }

    const result = await execute(transaction);
    const id = randomUUID();
    await transaction.query(
      `INSERT INTO "LicensingAgentUpdateOperation"
         ("id", "operationId", "action", "status", "actorId",
          "metadata", "createdAt", "completedAt")
       VALUES ($1, $2, $3, 'COMPLETED', $4, $5::jsonb, NOW(), NOW())`,
      [id, operationId, action, actorId, JSON.stringify({ request, result })],
    );
    await auditInTransaction(transaction, {
      actorId,
      action: `LICENSING_AGENT_UPDATE_${action}`,
      targetType: "LicensingAgentUpdateAuthority",
      targetId: typeof result.id === "string" ? result.id : id,
      metadata: { operationId, action },
    });
    await transaction.query("COMMIT");
    return result;
  } catch (error) {
    await transaction.query("ROLLBACK");
    throw error;
  } finally {
    transaction.release();
  }
}

function configuredSigningKeyIds(): string[] {
  const raw = process.env.BKE_AGENT_UPDATE_SIGNING_KEYS?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      return [];
    }
    return Object.entries(parsed as Record<string, unknown>)
      .filter(
        ([keyId, value]) =>
          /^[A-Za-z0-9._-]{1,64}$/u.test(keyId) &&
          typeof value === "string" &&
          Boolean(value.trim()),
      )
      .map(([keyId]) => keyId)
      .sort();
  } catch {
    return [];
  }
}

export async function getLicensingAgentUpdateAuthorityState() {
  const pool = getPostgresPool();
  const [keys, releases, artifacts] = await Promise.all([
    pool.query(
      `SELECT "id", "keyId", "algorithm", "publicKey", "trustedFromVersion",
              "status", "createdAt", "activatedAt", "retiredAt"
         FROM "LicensingAgentUpdateKey"
        ORDER BY "createdAt" DESC`,
    ),
    pool.query(
      `SELECT "id", "version", "minimumSupportedVersion", "revision",
              "audience", "channel", "releaseTag", "publishedAt", "active",
              "createdAt", "activatedAt", "retiredAt"
         FROM "LicensingAgentUpdateRelease"
        ORDER BY "audience", "revision" DESC`,
    ),
    pool.query(
      `SELECT "releaseId", "architecture", "artifactId", "sha256",
              "sizeBytes", "contentType"
         FROM "LicensingAgentUpdateArtifact"
        ORDER BY "releaseId", "architecture"`,
    ),
  ]);

  return {
    audience: licensingAgentUpdateAudience(),
    configuredSigningKeyIds: configuredSigningKeyIds(),
    keys: keys.rows,
    releases: releases.rows.map((release) => ({
      ...release,
      artifacts: artifacts.rows
        .filter((artifact) => artifact.releaseId === release.id)
        .map((artifact) => ({
          ...artifact,
          sizeBytes: String(artifact.sizeBytes),
        })),
    })),
  };
}

export async function registerLicensingAgentUpdateKey(input: {
  actorId: string;
  operationId: string;
  keyId: string;
  publicKey: string;
  trustedFromVersion: string;
}) {
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(input.keyId)) {
    throw new Error("AGENT_UPDATE_KEY_ID_INVALID");
  }
  if (!valid(input.trustedFromVersion)) {
    throw new Error("AGENT_UPDATE_KEY_TRUST_VERSION_INVALID");
  }

  const request = {
    keyId: input.keyId,
    publicKey: input.publicKey,
    trustedFromVersion: input.trustedFromVersion,
  };
  return mutation(
    input.actorId,
    input.operationId,
    "KEY_STAGED",
    request,
    async (transaction) => {
      const reference = licensingAgentUpdateKeyReference(input.keyId);
      const privateKey = resolveLicensingAgentUpdatePrivateKey(reference);
      assertLicensingAgentSigningMaterial(input.publicKey, privateKey);
      const id = randomUUID();
      await transaction.query(
        `INSERT INTO "LicensingAgentUpdateKey"
           ("id", "keyId", "algorithm", "publicKey", "privateKeyReference",
            "trustedFromVersion", "status", "createdById", "createdAt")
         VALUES ($1, $2, 'Ed25519', $3, $4, $5, 'STAGED', $6, NOW())`,
        [
          id,
          input.keyId,
          input.publicKey,
          reference,
          input.trustedFromVersion,
          input.actorId,
        ],
      );
      return {
        id,
        keyId: input.keyId,
        trustedFromVersion: input.trustedFromVersion,
        status: "STAGED",
      };
    },
  );
}

export async function activateLicensingAgentUpdateKey(input: {
  actorId: string;
  operationId: string;
  keyId: string;
}) {
  return mutation(
    input.actorId,
    input.operationId,
    "KEY_ACTIVATED",
    { keyId: input.keyId },
    async (transaction) => {
      const key = (
        await transaction.query<{
          id: string;
          keyId: string;
          publicKey: string;
          privateKeyReference: string;
          trustedFromVersion: string;
          status: string;
        }>(
          `SELECT "id", "keyId", "publicKey", "privateKeyReference",
                  "trustedFromVersion", "status"
             FROM "LicensingAgentUpdateKey"
            WHERE "keyId" = $1
            FOR UPDATE`,
          [input.keyId],
        )
      ).rows[0];
      if (!key) throw new Error("AGENT_UPDATE_KEY_NOT_FOUND");
      if (key.status === "RETIRED") throw new Error("AGENT_UPDATE_KEY_RETIRED");

      assertLicensingAgentSigningMaterial(
        key.publicKey,
        resolveLicensingAgentUpdatePrivateKey(key.privateKeyReference),
      );
      await transaction.query(
        `UPDATE "LicensingAgentUpdateKey"
            SET "status" = 'ACTIVE',
                "activatedAt" = COALESCE("activatedAt", NOW())
          WHERE "id" = $1`,
        [key.id],
      );
      return {
        id: key.id,
        keyId: key.keyId,
        trustedFromVersion: key.trustedFromVersion,
        status: "ACTIVE",
      };
    },
  );
}

export async function retireLicensingAgentUpdateKey(input: {
  actorId: string;
  operationId: string;
  keyId: string;
}) {
  return mutation(
    input.actorId,
    input.operationId,
    "KEY_RETIRED",
    { keyId: input.keyId },
    async (transaction) => {
      const key = (
        await transaction.query<{ id: string; status: string }>(
          `SELECT "id", "status"
             FROM "LicensingAgentUpdateKey"
            WHERE "keyId" = $1
            FOR UPDATE`,
          [input.keyId],
        )
      ).rows[0];
      if (!key) throw new Error("AGENT_UPDATE_KEY_NOT_FOUND");
      if (key.status === "RETIRED") {
        return { id: key.id, keyId: input.keyId, status: "RETIRED" };
      }

      if (key.status === "ACTIVE") {
        const activeReleases = (
          await transaction.query<{ minimumSupportedVersion: string }>(
            `SELECT "minimumSupportedVersion"
               FROM "LicensingAgentUpdateRelease"
              WHERE "active" = true`,
          )
        ).rows;
        const otherKeys = (
          await transaction.query<{ trustedFromVersion: string }>(
            `SELECT "trustedFromVersion"
               FROM "LicensingAgentUpdateKey"
              WHERE "status" = 'ACTIVE' AND "id" <> $1`,
            [key.id],
          )
        ).rows;

        for (const release of activeReleases) {
          const stillCovered = otherKeys.some(
            (candidate) =>
              valid(candidate.trustedFromVersion) &&
              valid(release.minimumSupportedVersion) &&
              lte(
                candidate.trustedFromVersion,
                release.minimumSupportedVersion,
              ),
          );
          if (!stillCovered) {
            throw new Error("AGENT_UPDATE_KEY_STILL_REQUIRED");
          }
        }
      }

      await transaction.query(
        `UPDATE "LicensingAgentUpdateKey"
            SET "status" = 'RETIRED', "retiredAt" = NOW()
          WHERE "id" = $1`,
        [key.id],
      );
      return { id: key.id, keyId: input.keyId, status: "RETIRED" };
    },
  );
}

export async function registerLicensingAgentUpdateRelease(input: {
  actorId: string;
  operationId: string;
  version: string;
  minimumSupportedVersion: string;
  revision: number;
}) {
  if (!valid(input.version) || !valid(input.minimumSupportedVersion)) {
    throw new Error("AGENT_UPDATE_RELEASE_VERSION_INVALID");
  }
  if (gt(input.minimumSupportedVersion, input.version)) {
    throw new Error("AGENT_UPDATE_MINIMUM_VERSION_INVALID");
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error("AGENT_UPDATE_REVISION_INVALID");
  }

  const audience = licensingAgentUpdateAudience();
  const request = {
    version: input.version,
    minimumSupportedVersion: input.minimumSupportedVersion,
    revision: input.revision,
    audience,
  };

  return mutation(
    input.actorId,
    input.operationId,
    "RELEASE_REGISTERED",
    request,
    async (transaction) => {
      const verified = await inspectLicensingAgentGitHubRelease(
        input.version,
        audience,
      );
      const id = randomUUID();
      await transaction.query(
        `INSERT INTO "LicensingAgentUpdateRelease"
           ("id", "version", "minimumSupportedVersion", "revision", "audience",
            "channel", "releaseTag", "publishedAt", "active", "createdById",
            "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'stable', $6, $7, false, $8, NOW(), NOW())`,
        [
          id,
          input.version,
          input.minimumSupportedVersion,
          input.revision,
          audience,
          verified.releaseTag,
          verified.publishedAt,
          input.actorId,
        ],
      );
      for (const artifact of verified.artifacts) {
        await transaction.query(
          `INSERT INTO "LicensingAgentUpdateArtifact"
             ("id", "releaseId", "architecture", "artifactId", "sha256",
              "sizeBytes", "contentType", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6,
                   'application/vnd.microsoft.portable-executable', NOW())`,
          [
            randomUUID(),
            id,
            artifact.architecture,
            artifact.artifactId,
            artifact.sha256,
            artifact.size,
          ],
        );
      }
      return {
        id,
        version: input.version,
        minimumSupportedVersion: input.minimumSupportedVersion,
        revision: input.revision,
        audience,
        releaseTag: verified.releaseTag,
        active: false,
        artifacts: verified.artifacts,
      };
    },
  );
}

export async function activateLicensingAgentUpdateRelease(input: {
  actorId: string;
  operationId: string;
  releaseId: string;
}) {
  return mutation(
    input.actorId,
    input.operationId,
    "RELEASE_ACTIVATED",
    { releaseId: input.releaseId },
    async (transaction) => {
      const target = (
        await transaction.query<{
          id: string;
          version: string;
          minimumSupportedVersion: string;
          revision: number;
          audience: "PREPRODUCTION" | "PRODUCTION";
          active: boolean;
          activatedAt: Date | null;
        }>(
          `SELECT "id", "version", "minimumSupportedVersion", "revision",
                  "audience", "active", "activatedAt"
             FROM "LicensingAgentUpdateRelease"
            WHERE "id" = $1
            FOR UPDATE`,
          [input.releaseId],
        )
      ).rows[0];
      if (!target) throw new Error("AGENT_UPDATE_RELEASE_NOT_FOUND");
      if (target.audience !== licensingAgentUpdateAudience()) {
        throw new Error("AGENT_UPDATE_RELEASE_AUDIENCE_MISMATCH");
      }
      if (target.active) {
        return {
          id: target.id,
          version: target.version,
          revision: target.revision,
          audience: target.audience,
          active: true,
        };
      }

      const artifacts = Number(
        (
          await transaction.query<{ count: string }>(
            `SELECT COUNT(*)::text AS "count"
               FROM "LicensingAgentUpdateArtifact"
              WHERE "releaseId" = $1`,
            [target.id],
          )
        ).rows[0]?.count ?? "0",
      );
      if (artifacts < 1) throw new Error("AGENT_UPDATE_RELEASE_HAS_NO_ARTIFACTS");

      const activeKeys = (
        await transaction.query<{ trustedFromVersion: string }>(
          `SELECT "trustedFromVersion"
             FROM "LicensingAgentUpdateKey"
            WHERE "status" = 'ACTIVE'`,
        )
      ).rows;
      if (
        !activeKeys.some(
          (key) =>
            valid(key.trustedFromVersion) &&
            lte(key.trustedFromVersion, target.minimumSupportedVersion),
        )
      ) {
        throw new Error("AGENT_UPDATE_RELEASE_HAS_NO_COMPATIBLE_SIGNING_KEY");
      }

      const history = (
        await transaction.query<{
          id: string;
          version: string;
          revision: number;
          active: boolean;
        }>(
          `SELECT "id", "version", "revision", "active"
             FROM "LicensingAgentUpdateRelease"
            WHERE "audience" = $1
              AND "activatedAt" IS NOT NULL
              AND "id" <> $2
            FOR UPDATE`,
          [target.audience, target.id],
        )
      ).rows;

      if (
        history.some(
          (prior) =>
            prior.revision >= target.revision ||
            !gt(target.version, prior.version),
        )
      ) {
        throw new Error("AGENT_UPDATE_RELEASE_ROLLBACK_FORBIDDEN");
      }

      const current = history.find((release) => release.active);
      if (current) {
        await transaction.query(
          `UPDATE "LicensingAgentUpdateRelease"
              SET "active" = false, "retiredAt" = NOW(), "updatedAt" = NOW()
            WHERE "id" = $1`,
          [current.id],
        );
      }

      await transaction.query(
        `UPDATE "LicensingAgentUpdateRelease"
            SET "active" = true,
                "activatedById" = $2,
                "activatedAt" = COALESCE("activatedAt", NOW()),
                "retiredAt" = NULL,
                "updatedAt" = NOW()
          WHERE "id" = $1`,
        [target.id, input.actorId],
      );
      return {
        id: target.id,
        version: target.version,
        revision: target.revision,
        audience: target.audience,
        active: true,
      };
    },
  );
}

export async function deactivateLicensingAgentUpdateRelease(input: {
  actorId: string;
  operationId: string;
  releaseId: string;
}) {
  return mutation(
    input.actorId,
    input.operationId,
    "RELEASE_DEACTIVATED",
    { releaseId: input.releaseId },
    async (transaction) => {
      const release = (
        await transaction.query<{
          id: string;
          version: string;
          audience: "PREPRODUCTION" | "PRODUCTION";
        }>(
          `SELECT "id", "version", "audience"
             FROM "LicensingAgentUpdateRelease"
            WHERE "id" = $1
            FOR UPDATE`,
          [input.releaseId],
        )
      ).rows[0];
      if (!release) throw new Error("AGENT_UPDATE_RELEASE_NOT_FOUND");
      if (release.audience !== licensingAgentUpdateAudience()) {
        throw new Error("AGENT_UPDATE_RELEASE_AUDIENCE_MISMATCH");
      }
      await transaction.query(
        `UPDATE "LicensingAgentUpdateRelease"
            SET "active" = false, "retiredAt" = NOW(), "updatedAt" = NOW()
          WHERE "id" = $1`,
        [release.id],
      );
      return {
        id: release.id,
        version: release.version,
        audience: release.audience,
        active: false,
      };
    },
  );
}
