import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "RELEASE_EVIDENCE_INGESTION_RETIRED",
      message: "GitHub is the software release authority; Digital Solutions no longer ingests release-certification evidence.",
    },
    { status: 410 },
  );
}
