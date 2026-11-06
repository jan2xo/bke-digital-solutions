import { NextResponse } from "next/server";

// Legacy artifact endpoints remain as explicit 410 responses; no S3 mutations run.
export async function PATCH() {
  return NextResponse.json({ error: "ARTIFACT_INGESTION_RETIRED" }, { status: 410 });
}
export async function DELETE() {
  return NextResponse.json({ error: "ARTIFACT_INGESTION_RETIRED" }, { status: 410 });
}
