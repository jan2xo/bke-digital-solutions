import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";
import { registerSchema } from "@/v2/apps/web/http/validation";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { hashToken, randomToken } from "@/lib/security/crypto";
import { sendVerificationEmail } from "@/lib/email";
import { apiError } from "@/lib/http";
import { recordLegalAcceptances } from "@/lib/legal/service";
import { REGISTRATION_LEGAL_TYPES } from "@/lib/legal/constants";
export async function POST(request:Request){try{assertSameOrigin(request);const ip=clientIp(request);if(!(await rateLimit(`register:${ip}`,5,3600)).allowed)return NextResponse.json({error:"RATE_LIMITED"},{status:429});const input=registerSchema.parse(await request.json());const existing=await db.user.findUnique({where:{email:input.email}});if(existing)return NextResponse.json({error:"ACCOUNT_EXISTS"},{status:409});const passwordHash=await hashPassword(input.password);const token=randomToken();const user=await db.$transaction(async tx=>{const created=await tx.user.create({data:{email:input.email,name:input.name,credential:{create:{passwordHash}},ownedAccounts:{create:{type:"INDIVIDUAL",displayName:input.name,billingEmail:input.email}}},include:{ownedAccounts:true}});await recordLegalAcceptances(tx,{userId:created.id,customerAccountId:created.ownedAccounts[0]!.id,types:REGISTRATION_LEGAL_TYPES,selectedVersionIds:input.legalVersionIds,context:"REGISTRATION",request});await tx.verificationToken.create({data:{identifier:input.email,purpose:"VERIFY_EMAIL",tokenHash:hashToken(token),expiresAt:new Date(Date.now()+30*60_000)}});return created});await createSession(user.id,request,{recent:true});let emailSent=true;try{await sendVerificationEmail(user.email,token)}catch{emailSent=false}return NextResponse.json({ok:true,emailSent},{status:201})}catch(error){return apiError(error)}}
