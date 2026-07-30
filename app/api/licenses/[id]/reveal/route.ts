import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptLicenseKey } from "@/lib/security/crypto";
import { assertSameOrigin } from "@/lib/security/request";
import { apiError } from "@/lib/http";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{assertSameOrigin(request);const user=await requireUser();const{id}=await params;const license=await db.license.findFirst({where:{id,account:{OR:[{ownerId:user.id},{memberships:{some:{userId:user.id,role:{in:["OWNER","LICENSE_MANAGER","BILLING"]}}}}]}}});if(!license)throw new Error("NOT_FOUND");if(!license.keyCiphertext||license.keyRevealedAt)return NextResponse.json({error:"KEY_ALREADY_REVEALED"},{status:409});const key=decryptLicenseKey(license.keyCiphertext);await db.license.update({where:{id},data:{keyCiphertext:null,keyRevealedAt:new Date()},select:{id:true}});return NextResponse.json({licenseKey:key})}catch(e){return apiError(e)}}
