import { createHash, generateKeyPairSync, sign, verify, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import {
  standaloneStartupAttestationContract,
  verifyStandaloneStartupInstallAttestationInTransaction,
} from "@/apps/web/agent-sessions/standalone-startup-install-attestation";
import {
  prepareAndSignStandaloneStartupPolicyInTransaction,
} from "@/apps/web/agent-sessions/standalone-startup-policy-issuance";

const machine = generateKeyPairSync("ed25519");
const ds = generateKeyPairSync("ed25519");
const alternate = generateKeyPairSync("ed25519");
const machinePublic = machine.publicKey.export({ format: "pem", type: "spki" }).toString();
const dsPublic = ds.publicKey.export({ format: "pem", type: "spki" }).toString();
const dsPrivate = ds.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const dsKid = "fixture-ds-startup-signer";
const machineKid = "fixture-installed-agent";
const deviceId = "device-" + "d".repeat(40);
const installationId = "00000000-0000-0000-0000-000000000001";
const imagePath = "C:\\Program Files\\BKE Digital Solutions\\Render Dock\\RENDER DOCK.exe";
const sid = "S-1-5-21-101-202-303-1001";
const now = new Date("2026-11-13T02:00:00.000Z");
const activeMachine = {
  kid: machineKid, deviceId, publicKeyPem: machinePublic, status: "ACTIVE",
};
const activeDS = {
  kid: dsKid, publicKeyPem: dsPublic,
  privateKeyReference: "keyset:" + dsKid, status: "ACTIVE",
};
const keyset = JSON.stringify({ [dsKid]: dsPrivate });
const releasedMode = {
  productId: "bke-render-dock", version: "1.0.3", activationMode: "LICENSE_KEY",
};

function agentProof(changes: Record<string, unknown> = {}, kid = machineKid) {
  const payload = JSON.stringify({
    schema: standaloneStartupAttestationContract.payloadSchema,
    product_id: "bke-render-dock",
    version: "1.0.3",
    installation_id: installationId,
    image_path: imagePath,
    image_sha256: "a".repeat(64),
    allowed_user_sid: sid,
    device_id: deviceId,
    attestation_id: randomUUID(),
    issued_at: new Date(now.getTime() - 1000).toISOString(),
    expires_at: new Date(now.getTime() + 60000).toISOString(),
    ...changes,
  });
  return JSON.stringify({
    schema: standaloneStartupAttestationContract.envelopeSchema,
    kid, payload,
    signature: sign(null, Buffer.from(
      standaloneStartupAttestationContract.signedDomain + payload, "utf8"),
      machine.privateKey).toString("base64"),
  });
}

function mockTx(mode: string | null = "LICENSE_KEY", proofRow = activeMachine) {
  const query = vi.fn()
    .mockResolvedValueOnce([proofRow])
    .mockResolvedValueOnce(mode === null ? [] : [{ ...releasedMode, activationMode: mode }])
    .mockResolvedValueOnce([{ attestationId: "" }])
    .mockResolvedValueOnce([activeDS]);
  const audit = vi.fn().mockResolvedValue({});
  // The receipt RETURNING is keyed by the attested UUID.
  const withProof = (proof: string) => {
    const id = (JSON.parse(JSON.parse(proof).payload) as { attestation_id: string }).attestation_id;
    query.mockReset()
      .mockResolvedValueOnce([proofRow])
      .mockResolvedValueOnce(mode === null ? [] : [{ ...releasedMode, activationMode: mode }])
      .mockResolvedValueOnce([{ attestationId: id }])
      .mockResolvedValueOnce([activeDS]);
  };
  const tx = { $queryRaw: query, auditLog: { create: audit } } as unknown as
    Prisma.TransactionClient;
  return { tx, query, audit, withProof };
}

describe("DS → Agent preproduction signed standalone startup policy", () => {
  it.each(["ACCOUNT", "LICENSE_KEY", "EITHER"] as const)(
    "signs real Ed25519 %s mode from locked SQL, never from client",
    async mode => {
      const proof = agentProof();
      const fx = mockTx(mode);
      fx.withProof(proof);
      const result = await prepareAndSignStandaloneStartupPolicyInTransaction(
        fx.tx, { signedAgentInstallAttestation: proof, keyset }, now);
      expect(result.status).toBe("issued");
      expect(result.kid).toBe(dsKid);
      expect(result.mode).toBe(mode);
      const envelope = JSON.parse(result.envelope);
      expect(envelope.schema).toBe("bke.standalone-startup-envelope.v1");
      const payload = JSON.parse(envelope.payload);
      expect(Object.keys(payload)).toEqual([
        "schema", "issuer_source_sha", "product_id", "version", "installation_id",
        "image_path", "image_sha256", "allowed_user_sid", "activation_mode",
        "not_before", "expires_at",
      ]);
      expect(payload).toMatchObject({
        schema: "bke.standalone-startup-policy.v1",
        issuer_source_sha: "09c16bc5c7e1d6ab3cb8df0ba569e6da05498f3f",
        product_id: "bke-render-dock", version: "1.0.3",
        installation_id: installationId, image_path: imagePath,
        image_sha256: "a".repeat(64), allowed_user_sid: sid,
        activation_mode: mode,
      });
      expect(payload.not_before).toBe("2026-11-13T02:00:00.0000000+00:00");
      expect(payload.expires_at).toBe("2026-11-13T03:00:00.0000000+00:00");
      expect(verify(null,
        Buffer.from("BKE-STANDALONE-STARTUP-POLICY-V1\n" + envelope.payload),
        ds.publicKey, Buffer.from(envelope.signature, "base64"))).toBe(true);
      expect(verify(null,
        Buffer.from("BKE-STANDALONE-STARTUP-POLICY-V1\n" + envelope.payload),
        alternate.publicKey, Buffer.from(envelope.signature, "base64"))).toBe(false);
      expect(fx.query).toHaveBeenCalledTimes(4);
      const queries = fx.query.mock.calls.map(v => String(v[0]));
      expect(queries[0]).toContain("AgentStartupAttestationSigningKey");
      expect(queries[1]).toContain("ProductActivationPolicy");
      expect(queries[1]).toContain("ProductVersion");
      expect(queries[1]).toContain("FOR SHARE OF p, policy, pv");
      expect(queries[2]).toContain("ON CONFLICT");
      expect(queries[3]).toContain("AccountProductLeaseSigningKey");
      expect(fx.audit).toHaveBeenCalledTimes(1);
      const audit = fx.audit.mock.calls[0]![0].data;
      expect(audit.action).toBe("AGENT_STANDALONE_STARTUP_POLICY_ISSUED");
      expect(audit.metadata.activationMode).toBe(mode);
      expect(audit.metadata.policySha256).toBe(
        createHash("sha256").update(result.envelope).digest("hex"));
      expect(JSON.stringify(audit)).not.toContain(dsPrivate);
      expect(JSON.stringify(audit)).not.toContain(imagePath);
      // A KEY-only product does not need an account ID, bearer, Google
      // identity or fake session to receive its signed mode projection.
      expect(JSON.stringify(result)).not.toContain("accountId");
    },
  );

  it("rejects missing, unknown or downgraded SQL mode before nonce or signing", async () => {
    for (const mode of [null, "UNKNOWN", "key", "ACCOUNT_OR_LICENSE_KEY"]) {
      const proof = agentProof();
      const fx = mockTx(mode);
      fx.withProof(proof);
      await expect(prepareAndSignStandaloneStartupPolicyInTransaction(
        fx.tx, { signedAgentInstallAttestation: proof, keyset }, now))
        .rejects.toThrow("STARTUP_POLICY_SQL_MODE_OR_RELEASE_UNAVAILABLE");
      expect(fx.query).toHaveBeenCalledTimes(2);
      expect(fx.audit).not.toHaveBeenCalled();
    }
  });

  it("denies unsigned, tampered and wrong-device installer attestations", async () => {
    for (const raw of [
      agentProof().replace("bke-render-dock", "foreign-product"),
      agentProof({ allowed_user_sid: "S-1-1-0" }),
      agentProof({ image_sha256: "not-sha256" }),
      agentProof({ image_path: "D:\\Other\\evil.exe" }),
      agentProof({ device_id: "device-other" + "d".repeat(28) }),
      agentProof({ expires_at: new Date(now.getTime() - 200).toISOString() }),
      agentProof({ issued_at: new Date(now.getTime() + 900).toISOString() }),
      agentProof({}, "unregistered-agent"),
      agentProof().replace('"kid":', '"kid":"duplicate","kid":'),
    ]) {
      const fx = mockTx();
      await expect(verifyStandaloneStartupInstallAttestationInTransaction(
        fx.tx, raw, now)).rejects.toThrow();
    }
  });

  it("denies wrong attestation signer, revoked key, or non-matching DS private key", async () => {
    for (const status of ["STAGED", "REVOKED"] as const) {
      const proof = agentProof();
      const fx = mockTx("LICENSE_KEY", { ...activeMachine, status });
      fx.withProof(proof);
      await expect(prepareAndSignStandaloneStartupPolicyInTransaction(
        fx.tx, { signedAgentInstallAttestation: proof, keyset }, now))
        .rejects.toThrow("STARTUP_ATTESTATION_UNTRUSTED_AGENT");
      expect(fx.audit).not.toHaveBeenCalled();
    }
    const proof = agentProof();
    const fx = mockTx();
    fx.withProof(proof);
    await expect(prepareAndSignStandaloneStartupPolicyInTransaction(
      fx.tx, { signedAgentInstallAttestation: proof,
        keyset: JSON.stringify({ [dsKid]: alternate.privateKey.export({
          format: "pem", type: "pkcs8",
        }).toString() }) }, now))
      .rejects.toThrow("ACCOUNT_PRODUCT_SIGNER_KEY_MISMATCH");
    expect(fx.audit).not.toHaveBeenCalled();
  });

  it("denies consumed attestation and never calls signer or audit", async () => {
    const proof = agentProof();
    const fx = mockTx();
    fx.withProof(proof);
    fx.query.mockReset().mockResolvedValueOnce([activeMachine])
      .mockResolvedValueOnce([releasedMode])
      .mockResolvedValueOnce([]);
    await expect(prepareAndSignStandaloneStartupPolicyInTransaction(
      fx.tx, { signedAgentInstallAttestation: proof, keyset }, now))
      .rejects.toThrow("STARTUP_POLICY_ATTESTATION_REPLAY");
    expect(fx.query).toHaveBeenCalledTimes(3);
    expect(fx.audit).not.toHaveBeenCalled();
  });
});
