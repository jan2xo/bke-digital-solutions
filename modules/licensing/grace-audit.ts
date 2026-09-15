import type { LicensingGraceMutation } from "@bke/licensing/contracts/grace-period.contract";
import type {
  LicensingGraceAtomicEffectTransaction,
  LicensingGraceMutationEffect,
} from "@bke/licensing/logic/grace-period-ports";
import { writeAuditWithExecutor } from "../../platform/audit";

export function createLicensingGraceAuditEffect(): LicensingGraceMutationEffect {
  return Object.freeze({
    async record(
      mutation: LicensingGraceMutation,
      transaction: LicensingGraceAtomicEffectTransaction,
    ) {
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
