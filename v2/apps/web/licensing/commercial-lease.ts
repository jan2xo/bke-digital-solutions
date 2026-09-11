import "server-only";

import {
  LICENSING_COMMERCIAL_LEASE_CAPABILITY_ID,
  type CommercialLeaseRequest,
  type CommercialLeaseResult,
} from "@bke/licensing/contracts/commercial-lease.contract";
import { getV2WebApplication } from "../runtime";

type CommercialLeaseCapability = Readonly<{
  issue(input: CommercialLeaseRequest): Promise<CommercialLeaseResult>;
}>;

export async function issueCommercialLease(
  input: CommercialLeaseRequest,
): Promise<CommercialLeaseResult> {
  const application = await getV2WebApplication();
  const capability = application.get<CommercialLeaseCapability>(
    LICENSING_COMMERCIAL_LEASE_CAPABILITY_ID,
  );
  return capability.issue(input);
}
