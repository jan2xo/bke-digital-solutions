import { NextResponse } from "next/server";
import { z } from "zod";
import { completeLoginChallenge } from "@/lib/admin-mfa";
import { apiError } from "@/lib/http";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { securityEvent } from "@/lib/security/events";
export async function POST(request:Request){try{assertSameOrigin(request);if(!(await rateLimit(`admin-mfa:${clientIp(request)}`,8,900)).allowed)throw new Error("RATE_LIMITED");const{code}=z.object({code:z.string().min(6).max(32)}).parse(await request.json());const result=await completeLoginChallenge(code,request);await securityEvent(result.recoveryUsed?"MFA_RECOVERY_USED":"MFA_CHALLENGE_SUCCEEDED",request,result.userId);return NextResponse.json({ok:true})}catch(error){await securityEvent("MFA_CHALLENGE_FAILED",request).catch(()=>undefined);return apiError(error)}}
