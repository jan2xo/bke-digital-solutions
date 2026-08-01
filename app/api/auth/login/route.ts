import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { createLoginChallenge } from "@/lib/admin-mfa";
import { loginSchema } from "@/lib/validation";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { securityEvent } from "@/lib/security/events";
import { apiError } from "@/lib/http";
export async function POST(request:Request){try{assertSameOrigin(request);const input=loginSchema.parse(await request.json());if(!(await rateLimit(`login:${clientIp(request)}:${input.email}`,8,900)).allowed)return NextResponse.json({error:"RATE_LIMITED"},{status:429});const user=await db.user.findUnique({where:{email:input.email},include:{credential:true,administratorMfa:true}});const valid=user?.credential?await verifyPassword(user.credential.passwordHash,input.password):false;if(!user||!valid)return NextResponse.json({error:"INVALID_CREDENTIALS"},{status:401});if(user.role==="ADMIN"){await securityEvent("ADMIN_PASSWORD_ACCEPTED",request,user.id);if(user.administratorMfa?.enabledAt){await createLoginChallenge(user.id);return NextResponse.json({ok:true,mfaRequired:true})}await createSession(user.id,request,{recent:true});return NextResponse.json({ok:true,mfaEnrollmentRequired:true})}await createSession(user.id,request,{recent:true});return NextResponse.json({ok:true})}catch(error){return apiError(error)}}
