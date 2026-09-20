import { NextResponse } from "next/server";

/** Software artifacts are published through GitHub Releases, not Digital Solutions. */
export async function POST() {
  return NextResponse.json(
    {
      error: "ARTIFACT_INGESTION_RETIRED",
      message: "GitHub Releases is the software distribution authority; Digital Solutions no longer accepts, verifies, or commissions software artifacts.",
    },
    { status: 410 },
  );
}
