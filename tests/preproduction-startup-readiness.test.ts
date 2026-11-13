import { afterEach, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  auditPreproductionStartupReadiness,
  verifyPreproductionStartupTarget,
  type ReadinessSql,
} from "../scripts/preproduction-startup-readiness";

// Deliberately DISPOSABLE and HERMETIC: no Neon or other network/database
// connection is available to this contract suite. Every query is simulated.
const roots: string[] = [];
const now = new Date("2026-11-13T09:00:00Z");

function fixture() {
  const signer = generateKeyPairSync("ed25519");
  const machine = generateKeyPairSync("ed25519");
  const activeKey = "preprod-test-signer";
  const machineKid = "preprod-test-installed-agent";
  const publicKeyPem = signer.publicKey.export({
    format: "pem", type: "spki",
  }).toString();
  const machinePem = machine.publicKey.export({
    format: "pem", type: "spki",
  }).toString();
  const machineFingerprint = createHash("sha256").update(
    machine.publicKey.export({ format: "der", type: "spki" })).digest("hex");
  const sourceDir = mkdtempSync(join(tmpdir(), "bke-preprod-readiness-"));
  roots.push(sourceDir);
  const migration = "20261113170000_agent_startup_es256_algorithm";
  mkdirSync(join(sourceDir, migration));
  const statement = "SELECT 1;\n";
  writeFileSync(join(sourceDir, migration, "migration.sql"), statement);
  const env: Record<string, string | undefined> = {
    NODE_ENV: "production", DEPLOYMENT_ENV: "staging",
    STANDALONE_STARTUP_POLICY_HTTP_ENABLED: "true",
    STANDALONE_STARTUP_POLICY_ISSUANCE_ENABLED: "true",
    PREPRODUCTION_ISOLATION_ACK: "ISOLATED_STAGING_DATABASE",
    APP_URL: "https://staging-bke.example.invalid/",
    DIRECT_DATABASE_URL:
      "postgresql://staging:secret@ep-test.neon.tech/bke_staging?sslmode=require",
    DATABASE_URL:
      "postgresql://staging:secret@ep-test-pooler.neon.tech/bke_staging?sslmode=require",
    PREPRODUCTION_DATABASE_HOST: "ep-test.neon.tech",
    PREPRODUCTION_DATABASE_NAME: "bke_staging",
    PREPRODUCTION_STARTUP_PRODUCT_ID: "bke-render-dock",
    PREPRODUCTION_STARTUP_PRODUCT_VERSION: "1.0.3",
    PREPRODUCTION_AGENT_KEY_ID: machineKid,
    ACCOUNT_PRODUCT_LEASE_SIGNING_KEYS_JSON: JSON.stringify({
      [activeKey]: signer.privateKey.export({
        format: "pem", type: "pkcs8",
      }).toString(),
    }),
  };
  const responses = {
    context: [{ database: "bke_staging" }],
    mock: [] as Array<{name:string}>,
    migrations: [{
      migration_name: migration,
      checksum: createHash("sha256").update(statement).digest("hex"),
      finished_at: now, rolled_back_at: null,
    }],
    products: [{ activationMode: "LICENSE_KEY" }],
    signers: [{
      kid: activeKey, publicKeyPem, privateKeyReference: "keyset:" + activeKey,
      status: "ACTIVE", activatedAt: now,
    }],
    machines: [{
      kid: machineKid, publicKeyPem: machinePem,
      publicKeySha256: machineFingerprint, algorithm: "Ed25519",
      stagedBy: "approved-first-admin", activatedBy: "different-approved-admin",
      activationProofSha256: createHash("sha256").update("disposable proof").digest("hex"),
      activatedAt: now, reviewedAt: now, revokedAt: null,
      stageRole: "ADMIN", stageState: "ACTIVE", stageSuspended: null,
      reviewRole: "ADMIN", reviewState: "ACTIVE", reviewSuspended: null,
    }],
    audits: [
      { action: "AGENT_STARTUP_MACHINE_KEY_STAGED",
        actorId: "approved-first-admin" },
      { action: "AGENT_STARTUP_MACHINE_KEY_ACTIVATED",
        actorId: "different-approved-admin" },
    ],
  };
  let networkStatements = 0;
  const sql: ReadinessSql = {
    async query<T extends Record<string, unknown>>(statement: string, args?: unknown[]) {
      networkStatements++;
      let key: keyof typeof responses;
      if (statement.includes("current_database()")) key = "context";
      else if (statement.includes("pg_namespace")) key = "mock";
      else if (statement.includes("_prisma_migrations")) key = "migrations";
      else if (statement.includes("ProductActivationPolicy")) key = "products";
      else if (statement.includes('FROM "AccountProductLeaseSigningKey"'))
        key = "signers";
      else if (statement.includes('FROM "AgentStartupAttestationSigningKey"'))
        key = "machines";
      else if (statement.includes('FROM "AuditLog"')) key = "audits";
      else throw new Error("Unexpected preproduction read-only query.");
      if (key === "machines" || key === "audits")
        expect(args).toEqual([machineKid]);
      if (key === "products")
        expect(args).toEqual(["bke-render-dock", "1.0.3"]);
      return { rows: responses[key] as T[] };
    },
  };
  return { env, responses, sql, sourceDir,
    getSqlQueryCount: () => networkStatements };
}

afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("isolated DS preproduction startup issuer readiness", () => {
  it("requires explicit staging HTTP+issuer opt-ins and an independently selected DB target", () => {
    const v = fixture();
    expect(verifyPreproductionStartupTarget(v.env).expectedDatabase).toBe("bke_staging");
    for (const [key, value] of [
      ["DEPLOYMENT_ENV", "production"],
      ["DEPLOYMENT_ENV", "test"],
      ["NODE_ENV", "test"],
      ["STANDALONE_STARTUP_POLICY_HTTP_ENABLED", "false"],
      ["STANDALONE_STARTUP_POLICY_ISSUANCE_ENABLED", "false"],
      ["PREPRODUCTION_ISOLATION_ACK", ""],
      ["APP_URL", "https://jl-bke.com/"],
      ["APP_URL", "http://staging.example.invalid/"],
      ["DIRECT_DATABASE_URL", "postgresql://a:b@ep-prod.neon.tech/bke_production"],
      ["DATABASE_URL", "postgresql://a:b@ep-prod.neon.tech/bke_production"],
      ["PREPRODUCTION_DATABASE_HOST", "ep-prod.neon.tech"],
      ["PREPRODUCTION_DATABASE_NAME", "bke_production"],
      ["PREPRODUCTION_STARTUP_PRODUCT_VERSION", "bad"],
      ["PREPRODUCTION_AGENT_KEY_ID", ""],
    ] as const) {
      expect(() => verifyPreproductionStartupTarget({
        ...v.env, [key]: value,
      })).toThrow(/^STARTUP_READINESS_/);
    }
  });

  it("passes only fully official SQL/schema/signature metadata, not a human approval", async () => {
    const v = fixture();
    const proof = await auditPreproductionStartupReadiness(
      v.sql, v.env, v.sourceDir);
    expect(proof).toEqual({
      officialMigrationCount: 1,
      productMode: "LICENSE_KEY",
      reviewedMachineAlgorithm: "Ed25519",
      sqlEvidenceOnly: true,
    });
    expect(v.getSqlQueryCount()).toBe(7);
  });

  it("refuses the legacy mock schema before looking at official migrations", async () => {
    const v = fixture();
    v.responses.mock.push({name:"bke_startup_mock_20261113"});
    await expect(auditPreproductionStartupReadiness(
      v.sql,v.env,v.sourceDir)).rejects.toThrow(
      "STARTUP_READINESS_MOCK_SCHEMA_NOT_AUTHORITY",
    );
    expect(v.getSqlQueryCount()).toBe(2);
  });

  it("refuses missing, extra, unchecked and corrupt official migration histories", async () => {
    const v = fixture();
    for (const histories of [
      [],
      [{ ...v.responses.migrations[0]!, checksum: "0".repeat(64) }],
      [{ ...v.responses.migrations[0]!, finished_at: null }],
      [{ ...v.responses.migrations[0]!, rolled_back_at: now }],
      [{ ...v.responses.migrations[0]!, migration_name: "untracked" }],
      [v.responses.migrations[0]!,v.responses.migrations[0]!],
    ]) {
      const original = v.responses.migrations.slice();
      v.responses.migrations.splice(0,Infinity,...histories);
      await expect(auditPreproductionStartupReadiness(
        v.sql,v.env,v.sourceDir)).rejects.toThrow(/^STARTUP_READINESS_/);
      v.responses.migrations.splice(0,Infinity,...original);
    }
  });

  it("refuses absent/unpublished or unsupported SQL activation modes", async () => {
    const v = fixture();
    for(const products of [[], [{activationMode:"UNSIGNED_MOCK"}]]) {
      v.responses.products.splice(0,Infinity,...products);
      await expect(auditPreproductionStartupReadiness(
        v.sql,v.env,v.sourceDir)).rejects.toThrow(
        "STARTUP_READINESS_PUBLISHED_SQL_PRODUCT_POLICY_MISSING",
      );
    }
  });

  it("requires exactly one ACTIVE signer whose public SPKI matches its private key", async () => {
    const v = fixture();
    const signer = v.responses.signers[0]!;
    const badKey = generateKeyPairSync("ed25519").privateKey.export({
      format:"pem",type:"pkcs8",
    }).toString();
    for(const bad of [
      { ...v.env, ACCOUNT_PRODUCT_LEASE_SIGNING_KEYS_JSON: "{}" },
      { ...v.env, ACCOUNT_PRODUCT_LEASE_SIGNING_KEYS_JSON:
        JSON.stringify({ [signer.kid]: badKey }) },
      { ...v.env, ACCOUNT_PRODUCT_LEASE_SIGNING_KEYS_JSON:
        "{not-json}" },
    ]) {
      await expect(auditPreproductionStartupReadiness(
        v.sql,bad,v.sourceDir)).rejects.toThrow(/^STARTUP_READINESS_/);
    }
    v.responses.signers.push({ ...signer, kid:"other-active-key" });
    await expect(auditPreproductionStartupReadiness(
      v.sql,v.env,v.sourceDir)).rejects.toThrow(
      "STARTUP_READINESS_ACTIVE_DS_SIGNER_MISSING",
    );
  });

  it("rejects self approval, inactive admins, missing proof, and altered machine SPKI", async () => {
    const v = fixture();
    const machine = v.responses.machines[0]!;
    for (const edit of [
      { activatedBy: machine.stagedBy },
      { reviewRole: "USER" },
      { stageState: "SUSPENDED" },
      { activationProofSha256: "" },
      { publicKeySha256: "a".repeat(64) },
      { algorithm: "UNSIGNED" },
      { reviewedAt: null },
      { revokedAt: now },
    ]) {
      v.responses.machines[0] = {...machine,...edit};
      await expect(auditPreproductionStartupReadiness(
        v.sql,v.env,v.sourceDir)).rejects.toThrow(
        "STARTUP_READINESS_INDEPENDENT_SQL_MACHINE_REVIEW_MISSING",
      );
    }
  });

  it("requires durable staged and activated audit records bound to independent actors", async () => {
    const v = fixture();
    v.responses.audits.pop();
    await expect(auditPreproductionStartupReadiness(
      v.sql,v.env,v.sourceDir)).rejects.toThrow(
      "STARTUP_READINESS_MACHINE_APPROVAL_AUDIT_MISSING",
    );
    v.responses.audits.push({
      action:"AGENT_STARTUP_MACHINE_KEY_ACTIVATED",actorId:"wrong-admin",
    });
    await expect(auditPreproductionStartupReadiness(
      v.sql,v.env,v.sourceDir)).rejects.toThrow(
      "STARTUP_READINESS_MACHINE_APPROVAL_AUDIT_MISSING",
    );
  });

  it("contains no mutation or secret-printing execution path in the operator CLI", () => {
    const src = readFileSync("scripts/verify-preproduction-startup-readiness.ts","utf8");
    expect(src).toContain("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(src).toContain('await client.query("ROLLBACK")');
    expect(src).not.toContain("migrate deploy");
    expect(src).not.toContain("prisma migrate resolve");
    expect(src).not.toContain("console.log(process.env");
    expect(src).not.toContain("JSON.stringify(process.env");
  });
});
