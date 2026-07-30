import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendVerificationEmail } from "@/lib/email";
import { assertSameOrigin,clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { hashToken,randomToken } from "@/lib/security/crypto";
import { apiError } from "@/lib/http";

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    if(user.emailVerified)return NextResponse.json({ok:true,alreadyVerified:true});
    const limit=await rateLimit(`verification-resend:${user.id}:${clientIp(request)}`,3,3600);
    if(!limit.allowed)return NextResponse.json({error:"RATE_LIMITED"},{status:429});
    if(!env.RESEND_API_KEY)return NextResponse.json({error:"EMAIL_NOT_CONFIGURED"},{status:503});
    const token=randomToken();
    await db.$transaction(async tx=>{
      await tx.verificationToken.deleteMany({where:{identifier:user.email,purpose:"VERIFY_EMAIL",usedAt:null}});
      await tx.verificationToken.create({data:{identifier:user.email,purpose:"VERIFY_EMAIL",tokenHash:hashToken(token),expiresAt:new Date(Date.now()+30*60_000)}});
    });
    await sendVerificationEmail(user.email,token);
    return NextResponse.json({ok:true});
  }catch(error){return apiError(error)}
}
