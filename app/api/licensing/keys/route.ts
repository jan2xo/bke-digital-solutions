import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureCommercialSigningKey } from "@/lib/licensing/signing-registry";
export async function GET() { try { await ensureCommercialSigningKey(); const keys=await db.commercialSigningKey.findMany({where:{status:{in:["ACTIVE","RETIRED"]}},orderBy:{createdAt:"asc"},select:{keyId:true,algorithm:true,publicKey:true,status:true,activatedAt:true,retiredAt:true}}); return NextResponse.json({keys:keys.map((key)=>({key_id:key.keyId,algorithm:key.algorithm,public_key:key.publicKey,status:key.status,activated_at:key.activatedAt,retired_at:key.retiredAt}))}, { headers: { "cache-control": "public, max-age=300" } }); } catch { return NextResponse.json({ error: "LEASE_SIGNING_NOT_CONFIGURED" }, { status: 503 }); } }
