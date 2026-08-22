import { NextResponse } from "next/server";

/** Installer bytes are accepted only through the presigned upload lifecycle. */
export async function POST() {
  return NextResponse.json({ error: "DIRECT_ARTIFACT_UPLOAD_REQUIRED", uploadEndpoint: "POST /api/admin/versions/:id/artifacts/uploads" }, { status: 410 });
}
