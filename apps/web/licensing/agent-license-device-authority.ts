import "server-only";

import {
  ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
  type AccountsAccountAccessCapability,
} from "@bke/accounts/contracts/account-access.contract";
import { roleHasAccountsCapability } from "@bke/accounts/logic/account-authorization-policy";
import { db } from "@/platform/host/db";
import { getV2WebApplication } from "@/apps/web/runtime";
import { issueAgentLicenseDeviceTargetHandle } from "@/apps/web/licensing/agent-license-device-management";

const DEVICE_LIMIT = 100;

type AuthorizedDeviceManager =
  | {
      readonly status: "authorized";
      readonly lifecycleState: string;
    }
  | {
      readonly status:
        | "account_forbidden"
        | "account_not_active"
        | "failed";
    };

async function authorizeDeviceManager(input: {
  principalId: string;
  accountId: string;
}): Promise<AuthorizedDeviceManager> {
  const application = await getV2WebApplication();
  const accountAccess =
    application.get<AccountsAccountAccessCapability>(
      ACCOUNTS_ACCOUNT_ACCESS_CAPABILITY_ID,
    );
  const access = await accountAccess.authorize({
    principalId: input.principalId,
    accountId: input.accountId,
  });

  if (access.status === "REJECTED") {
    return { status: "account_forbidden" };
  }
  if (access.status === "FAILED") {
    return { status: "failed" };
  }
  if (
    !roleHasAccountsCapability(
      access.effectiveRole,
      "DEACTIVATE_DEVICE",
    )
  ) {
    return { status: "account_forbidden" };
  }
  if (access.account.lifecycleState !== "ACTIVE") {
    return { status: "account_not_active" };
  }

  return {
    status: "authorized",
    lifecycleState: access.account.lifecycleState,
  };
}

export type AgentLicenseDeviceOverview =
  | {
      readonly status: "ready";
      readonly license: {
        readonly productName: string;
        readonly editionName: string | null;
        readonly keyLastFour: string;
        readonly maxDevices: number;
        readonly activeDevices: number;
      };
      readonly devices: readonly {
        readonly label: string | null;
        readonly operatingSystem: string | null;
        readonly architecture: string | null;
        readonly lastSeenAt: Date;
        readonly activatedAt: Date;
        readonly active: boolean;
        readonly managementHandle: string | null;
      }[];
    }
  | {
      readonly status:
        | "license_not_found"
        | "account_forbidden"
        | "account_not_active"
        | "failed";
    };

export async function getAgentLicenseDeviceOverview(input: {
  principalId: string;
  accountId: string;
  licenseId: string;
}): Promise<AgentLicenseDeviceOverview> {
  const authorization = await authorizeDeviceManager(input);
  if (authorization.status !== "authorized") {
    return authorization;
  }

  try {
    const license = await db.license.findFirst({
      where: {
        id: input.licenseId,
        accountId: input.accountId,
      },
      select: {
        id: true,
        keyLastFour: true,
        maxSeats: true,
        maxDevicesPerSeat: true,
        product: {
          select: { name: true },
        },
        edition: {
          select: { name: true },
        },
        activations: {
          orderBy: { lastSeenAt: "desc" },
          take: DEVICE_LIMIT,
          select: {
            id: true,
            label: true,
            operatingSystem: true,
            architecture: true,
            lastSeenAt: true,
            activatedAt: true,
            active: true,
          },
        },
        _count: {
          select: {
            activations: {
              where: { active: true },
            },
          },
        },
      },
    });

    if (!license) {
      return { status: "license_not_found" };
    }

    return {
      status: "ready",
      license: {
        productName: license.product.name,
        editionName: license.edition?.name ?? null,
        keyLastFour: license.keyLastFour,
        maxDevices:
          license.maxSeats *
          license.maxDevicesPerSeat,
        activeDevices: license._count.activations,
      },
      devices: license.activations.map((activation) => ({
        label: activation.label,
        operatingSystem: activation.operatingSystem,
        architecture: activation.architecture,
        lastSeenAt: activation.lastSeenAt,
        activatedAt: activation.activatedAt,
        active: activation.active,
        managementHandle: activation.active
          ? issueAgentLicenseDeviceTargetHandle(
              input.accountId,
              license.id,
              activation.id,
              activation.activatedAt,
            )
          : null,
      })),
    };
  } catch {
    return { status: "failed" };
  }
}

export type AgentLicenseDeviceDeactivateResult =
  | { readonly status: "deactivated" }
  | {
      readonly status:
        | "device_not_found"
        | "account_forbidden"
        | "account_not_active"
        | "failed";
    };

export async function deactivateAgentLicenseDevice(input: {
  principalId: string;
  accountId: string;
  licenseId: string;
  deviceActivationId: string;
}): Promise<AgentLicenseDeviceDeactivateResult> {
  const authorization = await authorizeDeviceManager(input);
  if (authorization.status !== "authorized") {
    return authorization;
  }

  try {
    return await db.$transaction(async (tx) => {
      const device = await tx.deviceActivation.findFirst({
        where: {
          id: input.deviceActivationId,
          licenseId: input.licenseId,
          active: true,
          license: {
            accountId: input.accountId,
          },
        },
        select: {
          id: true,
          licenseId: true,
          deviceHash: true,
        },
      });

      if (!device) {
        return { status: "device_not_found" } as const;
      }

      await tx.deviceActivation.update({
        where: { id: device.id },
        data: {
          active: false,
          deactivatedAt: new Date(),
        },
      });
      await tx.licenseEvent.create({
        data: {
          licenseId: device.licenseId,
          type: "DEACTIVATED",
          metadata: {
            deviceHash: device.deviceHash,
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: input.principalId,
          accountId: input.accountId,
          action: "DEVICE_DEACTIVATED",
          targetType: "DeviceActivation",
          targetId: device.id,
        },
      });

      return { status: "deactivated" } as const;
    }, { isolationLevel: "Serializable" });
  } catch {
    return { status: "failed" };
  }
}
