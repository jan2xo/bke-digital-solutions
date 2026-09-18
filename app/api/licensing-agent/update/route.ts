import { NextRequest, NextResponse } from "next/server";
import {
  LicensingAgentUpdateConfigurationError,
  LicensingAgentUpdateRequestError,
  licensingAgentUpdateConfigurationFromEnvironment,
  resolveSignedLicensingAgentUpdate,
} from "@/v2/platform/distribution/licensing-agent-update-authority";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const currentVersion = request.nextUrl.searchParams.get("version") ?? "";
  const platform = request.nextUrl.searchParams.get("platform") ?? "";
  const architecture = request.nextUrl.searchParams.get("architecture") ?? "";

  try {
    const policy = resolveSignedLicensingAgentUpdate(
      { currentVersion, platform, architecture },
      licensingAgentUpdateConfigurationFromEnvironment(process.env),
    );
    return NextResponse.json(policy, {
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
