import { NextResponse } from "next/server";

export function passwordAuthRetired() {
  return NextResponse.json(
    { error: "GOOGLE_SIGN_IN_REQUIRED" },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}

export function nativePasswordAuthRetired() {
  return NextResponse.json(
    { error: "GOOGLE_BROWSER_HANDOFF_REQUIRED" },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}

export function nativeSecurityMutationRetired() {
  return NextResponse.json(
    { error: "BROWSER_SECURITY_REQUIRED" },
    { status: 409, headers: { "cache-control": "no-store" } },
  );
}
