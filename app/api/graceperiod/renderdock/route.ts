import { NextResponse } from "next/server";
import {
  LICENSING_GRACE_PERIOD_CAPABILITY_ID,
  type LicensingGracePeriodCapability,
} from "@bke/licensing/contracts/grace-period.contract";
import { getV2WebApplication } from "@/v2/apps/web/runtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const application = await getV2WebApplication();
  const capability = application.get<LicensingGracePeriodCapability>(
    LICENSING_GRACE_PERIOD_CAPABILITY_ID,
  );
  const grace = await capability.readState("renderdock");
  return NextResponse.json(
    { grace },
    { headers: { "cache-control": "no-store" } },
  );
}
