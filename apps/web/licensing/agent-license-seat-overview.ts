import "server-only";

import { db } from "@/platform/host/db";
import {
  listAssignableLicenseUsers,
  readLicenseSeatState,
} from "@/apps/web/licensing/license-seat-management";
import {
  issueAgentLicenseSeatTargetHandle,
} from "@/apps/web/licensing/agent-license-seat-management";

export type AgentLicenseSeatOverview =
  | {
      readonly status: "ready";
      readonly license: {
        readonly productName: string;
        readonly editionName: string | null;
        readonly keyLastFour: string;
        readonly maxSeats: number;
        readonly assignedSeats: number;
        readonly availableSeats: number;
      };
      readonly targets: readonly {
        readonly email: string;
        readonly name: string | null;
        readonly assigned: boolean;
        readonly eligible: boolean;
        readonly managementHandle: string;
      }[];
    }
  | {
      readonly status:
        | "not_found"
        | "account_not_active"
        | "license_not_active"
        | "account_forbidden"
        | "failed";
    };

export async function getAgentLicenseSeatOverview(input: {
  principalId: string;
  accountId: string;
  licenseId: string;
}): Promise<AgentLicenseSeatOverview> {
  try {
    return await db.$transaction(async (tx) => {
      const [state, eligibleUsers, license] =
        await Promise.all([
          readLicenseSeatState(tx, {
            actorId: input.principalId,
            licenseId: input.licenseId,
          }),
          listAssignableLicenseUsers(tx, {
            actorId: input.principalId,
            licenseId: input.licenseId,
          }),
          tx.license.findUnique({
            where: { id: input.licenseId },
            select: {
              accountId: true,
              keyLastFour: true,
              product: {
                select: { name: true },
              },
              edition: {
                select: { name: true },
              },
            },
          }),
        ]);

      if (
        !license ||
        license.accountId !== input.accountId ||
        state.accountId !== input.accountId
      ) {
        return { status: "not_found" } as const;
      }

      const eligibleById = new Map(
        eligibleUsers.map((user) => [
          user.id,
          user,
        ]),
      );
      const assignmentsById = new Map(
        state.assignments.map((assignment) => [
          assignment.userId,
          assignment,
        ]),
      );
      const targetIds = new Set([
        ...eligibleById.keys(),
        ...assignmentsById.keys(),
      ]);

      const targets = [...targetIds]
        .map((userId) => {
          const eligible = eligibleById.get(userId);
          const assignment =
            assignmentsById.get(userId);
          const source = eligible ?? assignment;
          if (!source) {
            return null;
          }

          return {
            email: source.email,
            name: source.name,
            assigned: Boolean(assignment),
            eligible: Boolean(eligible),
            managementHandle:
              issueAgentLicenseSeatTargetHandle(
                input.accountId,
                userId,
              ),
          };
        })
        .filter(
          (target): target is NonNullable<typeof target> =>
            target !== null,
        )
        .sort((left, right) =>
          left.email.localeCompare(right.email),
        );

      return {
        status: "ready",
        license: {
          productName: license.product.name,
          editionName: license.edition?.name ?? null,
          keyLastFour: license.keyLastFour,
          maxSeats: state.maxSeats,
          assignedSeats: state.assignedSeats,
          availableSeats: state.availableSeats,
        },
        targets,
      } as const;
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof Error) {
      switch (error.message) {
        case "NOT_FOUND":
          return { status: "not_found" };
        case "ACCOUNT_NOT_ACTIVE":
          return { status: "account_not_active" };
        case "LICENSE_NOT_ACTIVE":
          return { status: "license_not_active" };
        case "ACCOUNT_ROLE_FORBIDDEN":
          return { status: "account_forbidden" };
      }
    }
    return { status: "failed" };
  }
}
