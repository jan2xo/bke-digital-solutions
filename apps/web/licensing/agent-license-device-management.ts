import "server-only";

import { createHmac } from "node:crypto";
import { db } from "@/platform/host/db";
import { env } from "@/platform/host/env";
import { safeEqual } from "@/platform/host/security/crypto";

const LICENSE_HANDLE_PREFIX = "bke-license-device-v1_";
const LICENSE_HANDLE_DOMAIN =
  "bke.agent.license-device.management.v1";
const DEVICE_HANDLE_PREFIX =
  "bke-license-device-target-v1_";
const DEVICE_HANDLE_DOMAIN =
  "bke.agent.license-device.target.v1";

function licenseDigest(
  accountId: string,
  licenseId: string,
  createdAt: Date | string,
) {
  const createdAtValue =
    createdAt instanceof Date
      ? createdAt.toISOString()
      : createdAt;

  return createHmac("sha256", env.SESSION_SECRET)
    .update(LICENSE_HANDLE_DOMAIN)
    .update("\0")
    .update(accountId)
    .update("\0")
    .update(licenseId)
    .update("\0")
    .update(createdAtValue)
    .digest("hex");
}

function deviceDigest(
  accountId: string,
  licenseId: string,
  deviceActivationId: string,
  activatedAt: Date | string,
) {
  const activatedAtValue =
    activatedAt instanceof Date
      ? activatedAt.toISOString()
      : activatedAt;

  return createHmac("sha256", env.SESSION_SECRET)
    .update(DEVICE_HANDLE_DOMAIN)
    .update("\0")
    .update(accountId)
    .update("\0")
    .update(licenseId)
    .update("\0")
    .update(deviceActivationId)
    .update("\0")
    .update(activatedAtValue)
    .digest("hex");
}

export function issueAgentLicenseDeviceManagementHandle(
  accountId: string,
  licenseId: string,
  createdAt: Date | string,
) {
  return `${LICENSE_HANDLE_PREFIX}${licenseDigest(
    accountId,
    licenseId,
    createdAt,
  )}`;
}

export function validAgentLicenseDeviceManagementHandle(
  handle: string,
) {
  return /^bke-license-device-v1_[0-9a-f]{64}$/.test(
    handle,
  );
}

export async function resolveAgentLicenseDeviceManagementHandle(
  input: {
    accountId: string;
    handle: string;
  },
): Promise<string | null> {
  if (!validAgentLicenseDeviceManagementHandle(input.handle)) {
    return null;
  }

  const licenses = await db.license.findMany({
    where: { accountId: input.accountId },
    select: {
      id: true,
      createdAt: true,
    },
  });

  for (const license of licenses) {
    const expected =
      issueAgentLicenseDeviceManagementHandle(
        input.accountId,
        license.id,
        license.createdAt,
      );
    if (safeEqual(expected, input.handle)) {
      return license.id;
    }
  }

  return null;
}

export function issueAgentLicenseDeviceTargetHandle(
  accountId: string,
  licenseId: string,
  deviceActivationId: string,
  activatedAt: Date | string,
) {
  return `${DEVICE_HANDLE_PREFIX}${deviceDigest(
    accountId,
    licenseId,
    deviceActivationId,
    activatedAt,
  )}`;
}

export function validAgentLicenseDeviceTargetHandle(
  handle: string,
) {
  return /^bke-license-device-target-v1_[0-9a-f]{64}$/.test(
    handle,
  );
}

export async function resolveAgentLicenseDeviceTargetHandle(
  input: {
    accountId: string;
    licenseId: string;
    handle: string;
  },
): Promise<string | null> {
  if (!validAgentLicenseDeviceTargetHandle(input.handle)) {
    return null;
  }

  const activations = await db.deviceActivation.findMany({
    where: {
      licenseId: input.licenseId,
      license: {
        accountId: input.accountId,
      },
    },
    select: {
      id: true,
      activatedAt: true,
    },
  });

  for (const activation of activations) {
    const expected = issueAgentLicenseDeviceTargetHandle(
      input.accountId,
      input.licenseId,
      activation.id,
      activation.activatedAt,
    );
    if (safeEqual(expected, input.handle)) {
      return activation.id;
    }
  }

  return null;
}
