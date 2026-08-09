import { NextResponse } from "next/server";
import { publicLeaseKey } from "@/lib/licensing-agent";
export async function GET() { try { return NextResponse.json(publicLeaseKey(), { headers: { "cache-control": "public, max-age=300" } }); } catch { return NextResponse.json({ error: "LEASE_SIGNING_NOT_CONFIGURED" }, { status: 503 }); } }
