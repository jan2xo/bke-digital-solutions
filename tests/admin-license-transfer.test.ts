import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    commercialLeaseOperation: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    customerAccount: { findUniqueOrThrow: vi.fn() },
    deviceActivation: { updateMany: vi.fn() },
    license: { update: vi.fn() },
  };
  return {
    requireRecentAdmin: vi.fn(),
    assertSameOrigin: vi.fn(),
    audit: vi.fn(),
    decryptLicenseKey: vi.fn(),
    sha256: vi.fn(),
    issueCommercialLease: vi.fn(),
    tx,
    db: {
      license: { findUniqueOrThrow: vi.fn() },
      orderItem: { findUniqueOrThrow: vi.fn() },
      licensePolicy: { findUnique: vi.fn() },
      commercialLeaseOperation: { findUnique: vi.fn(), create: vi.fn() },
      licenseLeaseRecord: { findUnique: vi.fn(), findFirst: vi.fn() },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("@/lib/auth", () => ({ requireRecentAdmin: mocks.requireRecentAdmin }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/security/request", () => ({ assertSameOrigin: mocks.assertSameOrigin }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/security/crypto", () => ({ decryptLicenseKey: mocks.decryptLicenseKey, sha256: mocks.sha256 }));
vi.mock("@/lib/licensing/commercial-lease", () => ({ issueCommercialLease: mocks.issueCommercialLease }));

const accountId = "cm1234567890123456789012345";
const licenseId = "license-1";

function transferRequest() {
  return new Request(`http://localhost/api/admin/licenses/${licenseId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ action: "TRANSFER", accountId, installationId: "target-installation", deviceId: "target-device" }),
  });
}

describe("administrative license transfer version binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRecentAdmin.mockResolvedValue({ id: "admin-1" });
    mocks.decryptLicenseKey.mockReturnValue("BKE-AUTHORITATIVE-KEY");
    mocks.sha256.mockReturnValue("target-device-hash");
    mocks.db.license.findUniqueOrThrow.mockResolvedValue({ id: licenseId, status: "ACTIVE", keyCiphertext: "ciphertext", orderItemId: "item-1", accountId: "source-account", expiresAt: null });
    mocks.db.orderItem.findUniqueOrThrow.mockResolvedValue({ policyId: "policy-1" });
    mocks.db.licensePolicy.findUnique.mockResolvedValue({ transferable: true });
    mocks.db.commercialLeaseOperation.findUnique.mockResolvedValue(null);
    mocks.db.commercialLeaseOperation.create.mockResolvedValue({ status: "PREPARED" });
    mocks.issueCommercialLease.mockResolvedValue({ lease: {} });
    mocks.tx.commercialLeaseOperation.findUniqueOrThrow.mockResolvedValue({ resultLeaseId: "replacement-lease" });
    mocks.tx.customerAccount.findUniqueOrThrow.mockResolvedValue({ id: accountId });
    mocks.tx.deviceActivation.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.license.update.mockResolvedValue({ id: licenseId, status: "ACTIVE", expiresAt: null, accountId });
    mocks.tx.commercialLeaseOperation.update.mockResolvedValue({});
    mocks.db.$transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
  });

  it("issues the replacement lease for the exact authoritative source version", async () => {
    mocks.db.licenseLeaseRecord.findFirst.mockResolvedValue({ leaseId: "source-lease", version: "1.2.3", installationId: "source-installation", deviceId: "source-device" });
    const { PATCH } = await import("@/app/api/admin/licenses/[id]/route");

    const response = await PATCH(transferRequest(), { params: Promise.resolve({ id: licenseId }) });

    expect(response.status).toBe(200);
    expect(mocks.issueCommercialLease).toHaveBeenCalledOnce();
    expect(mocks.issueCommercialLease).toHaveBeenCalledWith(expect.objectContaining({ action: "TRANSFER", predecessorLeaseId: "source-lease", productVersion: "1.2.3" }));
  });

  it("fails closed before preparing or issuing a transfer without an authoritative source version", async () => {
    mocks.db.licenseLeaseRecord.findFirst.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/admin/licenses/[id]/route");

    const response = await PATCH(transferRequest(), { params: Promise.resolve({ id: licenseId }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "TRANSFER_SOURCE_VERSION_REQUIRED" });
    expect(mocks.db.commercialLeaseOperation.create).not.toHaveBeenCalled();
    expect(mocks.issueCommercialLease).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed", "INVALID_LICENSE_VERSION"],
    ["1.2.3", "VERSION_NOT_ELIGIBLE"],
    ["1.2.3", "VERSION_NOT_ACCEPTED"],
  ])("keeps normal version-policy failure %s/%s on the transfer issuance path", async (sourceVersion, error) => {
    mocks.db.licenseLeaseRecord.findFirst.mockResolvedValue({ leaseId: "source-lease", version: sourceVersion, installationId: "source-installation", deviceId: "source-device" });
    mocks.issueCommercialLease.mockRejectedValueOnce(new Error(error));
    const { PATCH } = await import("@/app/api/admin/licenses/[id]/route");

    const response = await PATCH(transferRequest(), { params: Promise.resolve({ id: licenseId }) });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mocks.issueCommercialLease).toHaveBeenCalledWith(expect.objectContaining({ productVersion: sourceVersion }));
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});
