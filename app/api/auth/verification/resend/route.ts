import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendVerificationEmail } from "@/lib/email";
import { assertSameOrigin,clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { hashToken,randomToken } from "@/lib/security/crypto";
import { apiError } from "@/v2/apps/web/http/api-error";

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    if(user.emailVerified)return NextResponse.json({ok:true,alreadyVerified:true});
    const limit=await rateLimit(`verification-resend:${user.id}:${clientIp(request)}`,3,3600);
    if(!limit.allowed)return NextResponse.json({error:"RATE_LIMITED"},{status:429});
    const token=randomToken();
    await db.$transaction(async tx=>{
      await tx.verificationToken.deleteMany({where:{identifier:user.email,purpose:"VERIFY_EMAIL",usedAt:null}});
      await tx.verificationToken.create({data:{identifier:user.email,purpose:"VERIFY_EMAIL",tokenHash:hashToken(token),expiresAt:new Date(Date.now()+30*60_000)}});
    });
    await sendVerificationEmail(user.email,token);
    return NextResponse.json({ok:true});
  }catch(error){return apiError(error)}
}
