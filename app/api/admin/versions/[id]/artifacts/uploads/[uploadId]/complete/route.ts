import { NextResponse } from "next/server";

/** Installer verification is deferred; versions use an external URL. */
export async function POST() {
  return NextResponse.json({ error: "SOFTWARE_ARTIFACT_INTAKE_DEFERRED" }, { status: 410 });
}
