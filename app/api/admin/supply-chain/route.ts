import { NextResponse } from "next/server";
import { requireAdmin, requireRecentAdmin } from "@/lib/auth";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";

function retired() {
  return NextResponse.json(
    {
      error: "GITHUB_RELEASE_AUTHORITY",
      message: "Software release certification and supply-chain execution are managed by GitHub Actions and GitHub Releases.",
    },
    { status: 410 },
  );
}

export async function GET() {
  try {
    await requireAdmin();
    return retired();
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireRecentAdmin();
    return retired();
  } catch (error) {
    return apiError(error);
  }
}
