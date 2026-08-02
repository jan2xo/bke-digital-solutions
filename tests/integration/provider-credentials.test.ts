import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

describe.sequential("provider credential persistence constraints", () => {
  let actorId = "";
  let configurationId = "";
  afterAll(async () => {
    if (configurationId) await db.externalProviderConfiguration.delete({ where: { id: configurationId } }).catch(() => undefined);
    if (actorId) await db.user.delete({ where: { id: actorId } }).catch(() => undefined);
    await db.$disconnect();
  });

  it("stores ciphertext and masked hints without plaintext", async () => {
    actorId = (await db.user.create({ data: { email: `provider-${suffix}@bke.test`, role: "ADMIN", emailVerified: new Date() } })).id;
    const configuration = await db.externalProviderConfiguration.create({ data: { provider: "PAYMONGO", environment: "TEST", createdByUserId: actorId, updatedByUserId: actorId } });
    configurationId = configuration.id;
    const credential = await db.externalProviderCredential.create({ data: { configurationId, credentialType: "SECRET_KEY", encryptedValue: "v1.synthetic.tag.ciphertext", encryptionKeyVersion: 1, maskedHint: "sk_t••••abcd", createdByUserId: actorId } });
    expect(credential.encryptedValue).not.toContain("sk_test_real_value");
    expect(credential.maskedHint).toBe("sk_t••••abcd");
  });

  it("allows only one active credential of each type and permits replacement after revocation", async () => {
    await expect(db.externalProviderCredential.create({ data: { configurationId, credentialType: "SECRET_KEY", encryptedValue: "v1.second.tag.ciphertext", encryptionKeyVersion: 1, maskedHint: "sk_t••••efgh", createdByUserId: actorId } })).rejects.toBeTruthy();
    const active = await db.externalProviderCredential.findFirstOrThrow({ where: { configurationId, credentialType: "SECRET_KEY", revokedAt: null } });
    await db.externalProviderCredential.update({ where: { id: active.id }, data: { revokedAt: new Date() } });
    const replacement = await db.externalProviderCredential.create({ data: { configurationId, credentialType: "SECRET_KEY", encryptedValue: "v1.replacement.tag.ciphertext", encryptionKeyVersion: 2, maskedHint: "sk_t••••ijkl", createdByUserId: actorId } });
    await db.externalProviderCredential.update({ where: { id: active.id }, data: { replacedByCredentialId: replacement.id } });
    expect(await db.externalProviderCredential.count({ where: { configurationId, credentialType: "SECRET_KEY", revokedAt: null } })).toBe(1);
  });
});
