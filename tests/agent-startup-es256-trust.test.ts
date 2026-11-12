import { createHash, generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import {
  canonicalEs256PublicKey, parseEs256EnrollmentCandidate,
  verifyEs256Possession, verifyStartupEs256AttestationInTransaction,
  startupEs256Contract,
} from "@/apps/web/agent-sessions/standalone-startup-es256-attestation";
import {
  stageStartupEs256MachineKeyInTransaction,
  activateStartupEs256MachineKeyInTransaction,
} from "@/apps/web/agent-sessions/startup-machine-es256-admin";
import { verifyStandaloneStartupInstallAttestationInTransaction } from
  "@/apps/web/agent-sessions/standalone-startup-install-attestation";
import { prepareAndSignStandaloneStartupPolicyInTransaction } from
  "@/apps/web/agent-sessions/standalone-startup-policy-issuance";

const signer = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const issuer = generateKeyPairSync("ed25519");
const v1Signer = generateKeyPairSync("ed25519");
const kid = "ci-startup-es256-" + randomUUID();
const deviceId = "ci-machine-es256-" + randomUUID();
const pem = signer.publicKey.export({ type: "spki", format: "pem" }).toString();
const fingerprint = createHash("sha256").update(
  signer.publicKey.export({ type: "spki", format: "der" })).digest("hex");
const now = new Date("2026-11-13T03:00:00.000Z");
const adminA = "fixture-google-admin-one";
const adminB = "fixture-google-admin-two";

function candidate(changes: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema: startupEs256Contract.candidateSchema,
    kid, device_id: deviceId, algorithm: "ES256",
    public_key_pem: pem, status: "STAGED", ...changes,
  });
}
function signedProof(
  payloadChanges: Record<string, unknown> = {},
  envelopeChanges: Record<string, unknown> = {},
  signingKey = signer.privateKey,
) {
  const payload = JSON.stringify({
    schema: startupEs256Contract.payloadSchema, algorithm: "ES256",
    product_id: "bke-render-dock", version: "1.0.3",
    installation_id: "00000000-0000-0000-0000-000000000001",
    image_path: "C:\\Program Files\\BKE Digital Solutions\\Render Dock\\RENDER DOCK.exe",
    image_sha256: "a".repeat(64),
    allowed_user_sid: "S-1-5-21-101-202-303-1001",
    device_id: deviceId, attestation_id: randomUUID(),
    issued_at: new Date(now.getTime() - 1000).toISOString(),
    expires_at: new Date(now.getTime() + 59000).toISOString(),
    ...payloadChanges,
  });
  return JSON.stringify({
    schema: startupEs256Contract.envelopeSchema,
    kid, algorithm: "ES256", payload,
    signature: sign("sha256",
      Buffer.from(startupEs256Contract.signedDomain + payload),
      { key: signingKey, dsaEncoding: "ieee-p1363" }).toString("base64"),
    ...envelopeChanges,
  });
}
const staged = {
  kid, deviceId, publicKeyPem: pem, publicKeySha256: fingerprint,
  algorithm: "ES256", stagedBy: adminA, status: "STAGED",
};
const active = { ...staged, status: "ACTIVE" };
function txFixture(queries: unknown[][] = [], role = "ADMIN") {
  const query = vi.fn();
  for (const row of queries) query.mockResolvedValueOnce(row);
  const audit = vi.fn().mockResolvedValue({});
  const user = vi.fn().mockResolvedValue({
    role, lifecycleState: "ACTIVE", suspendedAt: null,
  });
  const tx = { $queryRaw: query,
    auditLog: { create: audit },
    user: { findUnique: user },
  } as unknown as Prisma.TransactionClient;
  return { tx, query, audit, user };
}

describe("source-only ES256 v2 installed-machine startup trust (NOT physical TPM evidence)", () => {
  it("canonical public P-256 SPKI is independently staged, fingerprinted and reviewed", async () => {
    const parsed = parseEs256EnrollmentCandidate(candidate());
    expect(parsed).toMatchObject({ kid, deviceId, publicKeyPem: pem,
      fingerprintSha256: fingerprint });
    expect(canonicalEs256PublicKey(pem).fingerprintSha256).toBe(fingerprint);
    const fx = txFixture([[], [{ kid }]]);
    expect(await stageStartupEs256MachineKeyInTransaction(fx.tx, {
      candidate: candidate(), reviewedFingerprintSha256: fingerprint,
    }, adminA)).toEqual({
      kid, publicKeySha256: fingerprint, algorithm: "ES256", status: "STAGED",
    });
    expect(fx.query).toHaveBeenCalledTimes(2);
    expect(String(fx.query.mock.calls[1]![0])).toContain("'ES256'");
    expect(fx.audit.mock.calls[0]![0].data.metadata).toMatchObject({
      algorithm: "ES256", hardwareAttested: false,
    });
    expect(JSON.stringify(fx.audit.mock.calls[0])).not.toContain("PRIVATE KEY");
  });

  it("enforces independent second ADMIN and actual ES256 proof-of-possession", async () => {
    const raw = signedProof();
    const same = txFixture([[staged]]);
    await expect(activateStartupEs256MachineKeyInTransaction(same.tx, {
      kid, confirmedFingerprintSha256: fingerprint, freshSignedInstallProof: raw,
    }, adminA, now)).rejects.toThrow("STARTUP_ES256_INDEPENDENT_ADMIN_REQUIRED");
    expect(same.query).toHaveBeenCalledTimes(1);
    const different = txFixture([[staged], [{ kid }]]);
    expect(await activateStartupEs256MachineKeyInTransaction(different.tx, {
      kid, confirmedFingerprintSha256: fingerprint, freshSignedInstallProof: raw,
    }, adminB, now)).toEqual({ kid, algorithm: "ES256", status: "ACTIVE" });
    expect(String(different.query.mock.calls[1]![0])).toContain("'ES256'");
    expect(different.audit.mock.calls[0]![0].data.metadata.hardwareAttested).toBe(false);

    const wrongKey = txFixture([[{ ...staged,
      publicKeyPem: generateKeyPairSync("ec", { namedCurve: "prime256v1" })
        .publicKey.export({ type: "spki", format: "pem" }).toString() }]]);
    await expect(activateStartupEs256MachineKeyInTransaction(wrongKey.tx, {
      kid, confirmedFingerprintSha256: fingerprint, freshSignedInstallProof: raw,
    }, adminB, now)).rejects.toThrow("STARTUP_ES256_FINGERPRINT_MISMATCH");
    const wrongActor = txFixture([], "CUSTOMER");
    await expect(stageStartupEs256MachineKeyInTransaction(wrongActor.tx, {
      candidate: candidate(), reviewedFingerprintSha256: fingerprint,
    }, adminA)).rejects.toThrow("STARTUP_ES256_ADMIN_REQUIRED");
  });

  it("rejects Ed25519, P-384, mistaken algorithm and noncanonical enrollment", () => {
    const edPem = v1Signer.publicKey.export({ format: "pem", type: "spki" }).toString();
    const p384 = generateKeyPairSync("ec", { namedCurve: "secp384r1" })
      .publicKey.export({ format: "pem", type: "spki" }).toString();
    for (const value of [
      candidate({ public_key_pem: edPem }),
      candidate({ public_key_pem: p384 }),
      candidate({ algorithm: "Ed25519" }),
      candidate({ schema: "bke.agent-startup-attestation-enrollment-candidate.v1" }),
      candidate({ status: "ACTIVE" }),
      candidate() + " ",
      candidate().replace('"kid":', '"kid":"fake","kid":'),
      candidate({ public_key_pem: "PRIVATE KEY" }),
    ]) expect(() => parseEs256EnrollmentCandidate(value)).toThrow();
  });

  it("verifies signed scope and denies stale, forged, swapped or downgraded proof", async () => {
    const raw = signedProof();
    const positive = verifyEs256Possession(raw, active, now);
    expect(positive).toMatchObject({
      signerKid: kid, deviceId, productId: "bke-render-dock",
      algorithm: "ES256", hardwareAttested: false,
    });
    const tx = txFixture([[active]]);
    const verified = await verifyStartupEs256AttestationInTransaction(tx.tx, raw, now);
    expect(verified.attestationId).toBe(positive.attestationId);
    expect(String(tx.query.mock.calls[0]![0])).toContain("'ES256'");

    for (const bad of [
      signedProof({ image_sha256: "oops" }),
      signedProof({ device_id: "not-this-device" }),
      signedProof({ image_path: "C:\\Windows\\System32\\evil.exe" }),
      signedProof({ algorithm: "Ed25519" }),
      signedProof({ schema: "bke.agent-startup-install-attestation.v1" }),
      signedProof({ expires_at: new Date(now.getTime() - 1).toISOString() }),
      signedProof({}, { algorithm: "Ed25519" }),
      signedProof({}, { schema: "bke.agent-startup-install-attestation-envelope.v1" }),
      signedProof({}, { signature: Buffer.alloc(64).toString("base64") }),
      signedProof({}, {}, generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey),
      raw + "\n",
    ]) expect(() => verifyEs256Possession(bad, active, now)).toThrow();

    for (const row of [
      { ...active, status: "STAGED" }, { ...active, status: "REVOKED" },
      { ...active, algorithm: "Ed25519" }, { ...active, publicKeyPem:
        v1Signer.publicKey.export({ format: "pem", type: "spki" }).toString() },
    ]) {
      const badTx = txFixture([[row]]);
      await expect(verifyStartupEs256AttestationInTransaction(
        badTx.tx, raw, now)).rejects.toThrow();
    }

    await expect(verifyStandaloneStartupInstallAttestationInTransaction(
      txFixture([[active]]).tx, raw, now)).rejects.toThrow("STARTUP_ATTESTATION_PROTOCOL_INVALID");
  });

  it("issues unchanged Agent-verifiable DS Ed25519 startup mode only after trusted ES256 proof", async () => {
    const proof = signedProof();
    const attestationId = (JSON.parse(JSON.parse(proof).payload) as
      { attestation_id: string }).attestation_id;
    const dsKid = "fixture-ds-es256-v2-issuer";
    const publicKey = issuer.publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKey = issuer.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const mode = {
      productId: "bke-render-dock", version: "1.0.3", activationMode: "LICENSE_KEY",
    };
    const fx = txFixture([
      [active], [mode], [{ attestationId }],
      [{ kid: dsKid, publicKeyPem: publicKey,
        privateKeyReference: "keyset:" + dsKid, status: "ACTIVE" }],
    ]);
    const result = await prepareAndSignStandaloneStartupPolicyInTransaction(fx.tx, {
      signedAgentInstallAttestation: proof,
      keyset: JSON.stringify({ [dsKid]: privateKey }),
    }, now);
    expect(result.mode).toBe("LICENSE_KEY");
    const envelope = JSON.parse(result.envelope);
    expect(envelope.schema).toBe("bke.standalone-startup-envelope.v1");
    expect(verify(null, Buffer.from(
      "BKE-STANDALONE-STARTUP-POLICY-V1\n" + envelope.payload),
    issuer.publicKey, Buffer.from(envelope.signature, "base64"))).toBe(true);
    const payload = JSON.parse(envelope.payload);
    expect(payload.activation_mode).toBe("LICENSE_KEY");
    expect(fx.audit.mock.calls[0]![0].data.metadata).toMatchObject({
      attestationAlgorithm: "ES256", hardwareAttested: false,
    });
    expect(String(fx.query.mock.calls[2]![0])).toContain("ON CONFLICT");
    expect(fx.query).toHaveBeenCalledTimes(4);
  });
});
