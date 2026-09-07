import type { LicensingGraceMutation } from "@bke/licensing/contracts/grace-period.contract";
import type { LicensingGraceMutationEffect } from "@bke/licensing/logic/grace-period-ports";
import { writeAuditWithExecutor } from "../../platform/audit";

export function createLicensingGraceAuditEffect(): LicensingGraceMutationEffect {
  return Object.freeze({
    async record(mutation: LicensingGraceMutation, transaction) {
      await writeAuditWithExecutor(transaction, {
        action: "GRACE_OVERRIDE_SET",
        targetType: "ProductGraceOverride",
        targetId: mutation.productKey,
        metadata: {
          product: mutation.productKey,
          oldValue: mutation.oldValue,
          newValue: mutation.newValue,
          operationSource: mutation.operationSource,
        },
      });
    },
  });
}
