import { NextRequest, NextResponse } from "next/server";
import {
  LicensingAgentUpdateConfigurationError,
  LicensingAgentUpdateRequestError,
  resolveLicensingAgentUpdate,
} from "@/platform/distribution/software-catalog";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const version = request.nextUrl.searchParams.get("version") ?? "";
  const platform = request.nextUrl.searchParams.get("platform") ?? "";
  const architecture = request.nextUrl.searchParams.get("architecture") ?? "";

  try {
    const result = resolveLicensingAgentUpdate({
      currentVersion: version,
      platform,
      architecture,
    });
    return NextResponse.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof LicensingAgentUpdateRequestError) {
      return NextResponse.json(
        { error: error.message },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    if (error instanceof LicensingAgentUpdateConfigurationError) {
      return NextResponse.json(
        { error: "licensing_agent_update_unavailable" },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }
    throw error;
  }
}
