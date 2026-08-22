import { NextResponse } from "next/server";
import { readGraceState } from "@/lib/grace-period";

export const dynamic = "force-dynamic";

export async function GET() {
  const grace = await readGraceState("renderdock");
  return NextResponse.json(
    { grace },
    { headers: { "cache-control": "no-store" } },
  );
}
