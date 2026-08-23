import { NextResponse } from "next/server";

/** Installer intake is deferred; administrators configure an external URL. */
export async function POST() {
  return NextResponse.json({ error: "SOFTWARE_ARTIFACT_INTAKE_DEFERRED" }, { status: 410 });
}
