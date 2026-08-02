import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { hashToken, randomToken } from "@/lib/security/crypto";
import { rateLimit } from "@/lib/security/rate-limit";
import { apiError } from "@/lib/http";
import { assertLegalAcceptanceCurrent } from "@/lib/legal/service";
export async function GET(_:Request,{params}:{params:Promise<{artifactId:string}>}){try{const user=await requireUser();await assertLegalAcceptanceCurrent(user.id);if(!user.emailVerified)throw new Error("FORBIDDEN");if(!(await rateLimit(`download:${user.id}`,30,3600)).allowed)return NextResponse.json({error:"RATE_LIMITED"},{status:429});const {artifactId}=await params;const artifact=await db.productArtifact.findFirst({where:{id:artifactId,active:true,product:{licenses:{some:{status:"ACTIVE",account:{OR:[{ownerId:user.id},{memberships:{some:{userId:user.id}}}]},OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}}}}});if(!artifact)throw new Error("NOT_FOUND");const license=await db.license.findFirstOrThrow({where:{productId:artifact.productId,status:"ACTIVE",account:{OR:[{ownerId:user.id},{memberships:{some:{userId:user.id}}}]},OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}});const token=randomToken();await db.downloadGrant.create({data:{licenseId:license.id,artifactId:artifact.id,tokenHash:hashToken(token),expiresAt:new Date(Date.now()+60_000)}});return NextResponse.redirect(new URL(`/api/downloads/grants/${token}`,process.env.APP_URL),{status:303})}catch(e){return apiError(e)}}
