import "server-only";

import {
  IDENTITY_LOOKUP_CAPABILITY_ID,
  type IdentityLookupCapability,
} from "@bke/identity/contracts/identity.contract";
import {
  LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID,
  type LegalReacceptanceStatusCapability,
} from "@bke/legal/contracts/reacceptance-status.contract";
import { redirect } from "next/navigation";
import { getV2WebApplication } from "@/v2/apps/web/runtime";

export async function requireLegalClearance(userId: string, returnTo: string) {
  const application = await getV2WebApplication();
  const identity = application.get<IdentityLookupCapability>(IDENTITY_LOOKUP_CAPABILITY_ID);
  const legal = application.get<LegalReacceptanceStatusCapability>(
    LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID,
  );

  const principal = await identity.findById(userId);
  if (principal.status === "NOT_FOUND") return;
  if (principal.status === "FAILED") throw new Error(principal.code);

  const status = await legal.check({
    principalId: principal.principal.id,
    principalEstablishedAt: principal.principal.establishedAt,
  });
  if (status.status === "FAILED") throw new Error(status.code);
  if (status.status === "REACCEPTANCE_REQUIRED") {
    redirect(`/legal/accept?returnTo=${encodeURIComponent(returnTo)}`);
  }
}
