import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { grace: false },
    { headers: { "cache-control": "no-store" } },
  );
}
