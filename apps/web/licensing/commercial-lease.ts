import "server-only";

import {
  LICENSING_COMMERCIAL_LEASE_CAPABILITY_ID,
  type CommercialLeaseRequest,
  type CommercialLeaseResult,
} from "@bke/licensing/contracts/commercial-lease.contract";
import { getV2WebApplication } from "../runtime";
import { db } from "@/platform/host/db";
import { hashLicenseKey } from "@/platform/host/security/crypto";
import { allowsProductActivation } from "./product-activation-mode";

type CommercialLeaseCapability = Readonly<{
  issue(input: CommercialLeaseRequest): Promise<CommercialLeaseResult>;
}>;

/**
 * Existing commercial license keys remain usable without a Google or BKE
 * account sign-in. The DS key hash resolves a real purchased license's product.
 * ACCOUNT-only products cannot issue a key-based lease. Other license validity,
 * activation limits, version, expiry, revocation and signing protections remain
 * owned by the existing immutable @bke/licensing commercial lease capability.
 */
export async function requireCommercialLicenseKeyActivation(
  licenseKey: string,
): Promise<void> {
  if (typeof licenseKey !== "string" || !licenseKey.trim())
    throw new Error("INVALID_LICENSE");
  const rows = await db.$queryRaw<Array<{ activationMode: string }>>`
    SELECT p."activationMode"
      FROM "License" l
      JOIN "Product" p ON p."id" = l."productId"
     WHERE l."keyHash" = ${hashLicenseKey(licenseKey)}
     LIMIT 1
  `;
  if (rows.length !== 1 ||
      !allowsProductActivation(rows[0]!.activationMode, "LICENSE_KEY"))
    throw new Error("INVALID_LICENSE");
}

export async function issueCommercialLease(
  input: CommercialLeaseRequest,
): Promise<CommercialLeaseResult> {
  await requireCommercialLicenseKeyActivation(input.licenseKey);
  const application = await getV2WebApplication();
  const capability = application.get<CommercialLeaseCapability>(
    LICENSING_COMMERCIAL_LEASE_CAPABILITY_ID,
  );
  return capability.issue(input);
}
