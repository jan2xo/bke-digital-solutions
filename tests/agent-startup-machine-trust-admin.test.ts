import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/platform/persistence/generated/prisma/client";
import {
  stageStartupMachineKeyInTransaction,
  activateStartupMachineKeyInTransaction,
  revokeStartupMachineKeyInTransaction,
} from "@/apps/web/agent-sessions/startup-machine-trust-admin";

const privateKey = generateKeyPairSync("ed25519");
const publicKeyPem = privateKey.publicKey.export({ format: "pem", type: "spki" }).toString();
const publicKeySha256 = createHash("sha256").update(
  privateKey.publicKey.export({ format: "der", type: "spki" })).digest("hex");
const kid = "startup-" + randomUUID().replaceAll("-", "");
const deviceId = "startup-device-" + randomUUID().replaceAll("-", "");
const firstAdmin = "google-admin-one";
const secondAdmin = "google-admin-two";
const now = new Date("2026-11-13T07:00:00.000Z");

const candidate = JSON.stringify({
  schema: "bke.agent-startup-attestation-enrollment-candidate.v1",
  kid, device_id: deviceId, public_key_pem: publicKeyPem, status: "STAGED",
});
const stageRow = {
  kid, deviceId, publicKeyPem, publicKeySha256,
  stagedBy: firstAdmin, status: "STAGED",
};

function proof(changes: Record<string, unknown> = {}, signer = privateKey) {
  const payload = JSON.stringify({
    schema: "bke.agent-startup-install-attestation.v1",
    product_id: "bke-render-dock",
    version: "1.0.3",
    installation_id: "00000000-0000-0000-0000-000000000001",
    image_path: "C:\\Program Files\\BKE Digital Solutions\\Render Dock\\RENDER DOCK.exe",
    image_sha256: "a".repeat(64),
    allowed_user_sid: "S-1-5-21-101-202-303-1001",
    device_id: deviceId,
    attestation_id: randomUUID(),
    issued_at: new Date(now.getTime() - 1000).toISOString(),
    expires_at: new Date(now.getTime() + 59000).toISOString(),
    ...changes,
  });
  return JSON.stringify({
    schema: "bke.agent-startup-install-attestation-envelope.v1", kid, payload,
    signature: sign(null,
      Buffer.from("BKE-AGENT-STARTUP-INSTALL-ATTESTATION-V1\n" + payload),
      signer.privateKey).toString("base64"),
  });
}
function makeTx(returns: unknown[][], actor = "ADMIN", suspendedAt: Date | null = null) {
  const query = vi.fn();
  for (const result of returns) query.mockResolvedValueOnce(result);
  const audit = vi.fn().mockResolvedValue({});
  const lookup = vi.fn().mockResolvedValue({
    role: actor, lifecycleState: "ACTIVE", suspendedAt,
  });
  const tx = { $queryRaw: query,
    auditLog: { create: audit }, user: { findUnique: lookup },
  } as unknown as Prisma.TransactionClient;
  return { tx, query, audit, lookup };
}

describe("dual-admin signed startup machine trust review (source only)", () => {
  it("stages ONLY canonical public identity after first administrator checks fingerprint", async () => {
    const f = makeTx([[], [{ kid }]]);
    const result = await stageStartupMachineKeyInTransaction(f.tx,
      { candidate, reviewedFingerprintSha256: publicKeySha256 }, firstAdmin);
    expect(result).toEqual({ kid, publicKeySha256, status: "STAGED" });
    expect(f.query).toHaveBeenCalledTimes(2);
    expect(String(f.query.mock.calls[0]![0])).toContain("FOR UPDATE");
    expect(String(f.query.mock.calls[1]![0])).toContain("'STAGED'");
    expect(f.audit).toHaveBeenCalledTimes(1);
    expect(f.audit.mock.calls[0]![0].data.actorId).toBe(firstAdmin);
    expect(JSON.stringify(f.audit.mock.calls[0]![0])).not.toContain(publicKeyPem);
  });

  it("rejects fingerprint replacement, candidate tamper and unauthenticated/non-admin staging", async () => {
    for (const invalid of [
      candidate.replace("STAGED", "ACTIVE"),
      candidate.replace('"kid":', '"kid":"fake","kid":'),
      candidate.replace('"public_key_pem":', '"public_key_pem":"PRIVATE KEY","public_key_pem":'),
    ]) {
      const f = makeTx([]);
      await expect(stageStartupMachineKeyInTransaction(f.tx,
        { candidate: invalid, reviewedFingerprintSha256: publicKeySha256 }, firstAdmin))
        .rejects.toThrow();
      expect(f.query).not.toHaveBeenCalled();
      expect(f.audit).not.toHaveBeenCalled();
    }
    for (const role of ["CUSTOMER", "UNKNOWN"]) {
      const f = makeTx([], role);
      await expect(stageStartupMachineKeyInTransaction(f.tx,
        { candidate, reviewedFingerprintSha256: publicKeySha256 }, firstAdmin))
        .rejects.toThrow("MACHINE_KEY_ADMIN_REQUIRED");
    }
    const f = makeTx([]);
    await expect(stageStartupMachineKeyInTransaction(f.tx,
      { candidate, reviewedFingerprintSha256: "f".repeat(64) }, firstAdmin))
      .rejects.toThrow("MACHINE_KEY_INDEPENDENT_FINGERPRINT_MISMATCH");
    expect(f.audit).not.toHaveBeenCalled();
  });

  it("requires a DIFFERENT administrator and a fresh real Ed25519 installer possession proof", async () => {
    const good = proof();
    const f = makeTx([[stageRow], [{ kid }]]);
    const result = await activateStartupMachineKeyInTransaction(f.tx, {
      kid, confirmedFingerprintSha256: publicKeySha256,
      freshSignedInstallProof: good,
    }, secondAdmin, now);
    expect(result).toEqual({ kid, status: "ACTIVE" });
    expect(f.query).toHaveBeenCalledTimes(2);
    expect(String(f.query.mock.calls[0]![0])).toContain("FOR UPDATE");
    expect(String(f.query.mock.calls[1]![0])).toContain("'STAGED'");
    const audit = f.audit.mock.calls[0]![0].data;
    expect(audit.actorId).toBe(secondAdmin);
    expect(audit.metadata.stagedBy).toBe(firstAdmin);
    expect(audit.metadata.proofSha256).toBe(createHash("sha256").update(good).digest("hex"));
    expect(JSON.stringify(audit)).not.toContain(publicKeyPem);
    expect(JSON.stringify(audit)).not.toContain(good);
    const oneAdmin = makeTx([[stageRow]]);
    await expect(activateStartupMachineKeyInTransaction(oneAdmin.tx, {
      kid, confirmedFingerprintSha256: publicKeySha256,
      freshSignedInstallProof: good,
    }, firstAdmin, now)).rejects.toThrow("MACHINE_KEY_INDEPENDENT_ADMIN_REQUIRED");
    expect(oneAdmin.query).toHaveBeenCalledTimes(1);
    expect(oneAdmin.audit).not.toHaveBeenCalled();
  });

  it("denies forged, expired, wrong-machine and wrong-fingerprint activation", async () => {
    const otherKey = generateKeyPairSync("ed25519");
    for (const item of [
      proof({}, otherKey),
      proof({ device_id: "startup-device-" + randomUUID().replaceAll("-", "") }),
      proof({ expires_at: new Date(now.getTime() - 500).toISOString() }),
      proof({ issued_at: new Date(now.getTime() + 500).toISOString() }),
      proof().replace('"kid":', '"kid":"fake","kid":'),
    ]) {
      const f = makeTx([[stageRow]]);
      await expect(activateStartupMachineKeyInTransaction(f.tx, {
        kid, confirmedFingerprintSha256: publicKeySha256,
        freshSignedInstallProof: item,
      }, secondAdmin, now)).rejects.toThrow();
      expect(f.query).toHaveBeenCalledTimes(1);
      expect(f.audit).not.toHaveBeenCalled();
    }
    const f = makeTx([[stageRow]]);
    await expect(activateStartupMachineKeyInTransaction(f.tx, {
      kid, confirmedFingerprintSha256: "a".repeat(64),
      freshSignedInstallProof: proof(),
    }, secondAdmin, now)).rejects.toThrow(
      "MACHINE_KEY_INDEPENDENT_FINGERPRINT_MISMATCH");
  });

  it("irreversibly revokes a staged or active key with admin audit and no plaintext reason", async () => {
    for (const status of ["STAGED", "ACTIVE"]) {
      const f = makeTx([[{ kid, status }], [{ kid }]]);
      const result = await revokeStartupMachineKeyInTransaction(f.tx,
        kid, secondAdmin, "independent administrator requested revocation", now);
      expect(result.status).toBe("REVOKED");
      expect(f.audit).toHaveBeenCalledTimes(1);
      expect(f.audit.mock.calls[0]![0].data.action)
        .toBe("AGENT_STARTUP_MACHINE_KEY_REVOKED");
      expect(JSON.stringify(f.audit.mock.calls[0]![0]))
        .not.toContain("independent administrator requested revocation");
      const again = makeTx([[{ kid, status: "REVOKED" }]]);
      await expect(revokeStartupMachineKeyInTransaction(again.tx,
        kid, secondAdmin, "already revoked, cannot reverse", now))
        .rejects.toThrow("MACHINE_KEY_ALREADY_REVOKED_OR_UNKNOWN");
      expect(again.audit).not.toHaveBeenCalled();
    }
  });

  it("does not create an audit or grant when SQL transitions cannot commit", async () => {
    const f = makeTx([[stageRow], []]);
    await expect(activateStartupMachineKeyInTransaction(f.tx, {
      kid, confirmedFingerprintSha256: publicKeySha256,
      freshSignedInstallProof: proof(),
    }, secondAdmin, now)).rejects.toThrow("MACHINE_KEY_ACTIVATION_CONFLICT");
    expect(f.audit).not.toHaveBeenCalled();
  });
});
