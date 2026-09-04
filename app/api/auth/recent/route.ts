import { NextResponse } from "next/server";
import { z } from "zod";
import { ADMIN_EMAIL_CHALLENGE_COOKIE, consumeValidatedChallenge, validateEmailOrRecoveryCode } from "@/lib/admin-mfa";
import { currentSession, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/v2/apps/web/http/api-error";
import { securityEvent } from "@/lib/security/events";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";

const schema = z.object({ password: z.string().min(1).max(128), code: z.string().min(6).max(32).optional() });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request); const session=await currentSession(); if(!session)throw new Error("UNAUTHENTICATED");
    if(!(await rateLimit(`recent:${session.userId}:${clientIp(request)}`,5,900)).allowed)throw new Error("RATE_LIMITED");
    const{password,code}=schema.parse(await request.json()); const credential=await db.passwordCredential.findUnique({where:{userId:session.userId}});
    if(!credential||!(await verifyPassword(credential.passwordHash,password))){await securityEvent("RECENT_AUTH_FAILED",request,session.userId);throw new Error("INVALID_CREDENTIALS")}
    let recoveryId:string|undefined; let challengeId:string|undefined;
    if(session.user.role==="ADMIN"){
      if(!code)throw new Error("INVALID_CREDENTIALS");
      const validated=await validateEmailOrRecoveryCode(code,"RECENT_AUTH",session.userId);challengeId=validated.challenge.id;recoveryId=validated.recovery?.id;
      await consumeValidatedChallenge(challengeId,recoveryId);
    }
    await db.session.update({where:{id:session.id},data:{recentAuthenticatedAt:new Date(),assuranceLevel:"RECENTLY_AUTHENTICATED"}});
    if(recoveryId)await securityEvent("MFA_RECOVERY_USED",request,session.userId,undefined,{sessionId:session.id,authenticationMethod:"PASSWORD_RECOVERY"});
    await securityEvent("RECENT_AUTH_SUCCEEDED",request,session.userId,undefined,{sessionId:session.id,authenticationMethod:recoveryId?"PASSWORD_RECOVERY":session.user.role==="ADMIN"?"PASSWORD_EMAIL_OTP":"PASSWORD"});
    const response=NextResponse.json({ok:true});if(session.user.role==="ADMIN")response.cookies.delete(ADMIN_EMAIL_CHALLENGE_COOKIE);return response;
  }catch(error){return apiError(error)}
}
