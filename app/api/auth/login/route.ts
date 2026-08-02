import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { createLoginChallenge } from "@/lib/admin-mfa";
import { loginSchema } from "@/lib/validation";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { securityEvent } from "@/lib/security/events";
import { apiError } from "@/lib/http";
export async function POST(request:Request){try{assertSameOrigin(request);const input=loginSchema.parse(await request.json());const user=await db.user.findUnique({where:{email:input.email},include:{credential:true,administratorMfa:true}});if(!(await rateLimit(`login:${clientIp(request)}:${input.email}`,8,900)).allowed){if(user?.role==="ADMIN")await securityEvent("SECURITY_RATE_LIMIT_TRIGGERED",request,user.id,{reason:"login"});return NextResponse.json({error:"RATE_LIMITED"},{status:429})}const valid=user?.credential?await verifyPassword(user.credential.passwordHash,input.password):false;if(!user||!valid){if(user?.role==="ADMIN")await securityEvent("ADMIN_PASSWORD_REJECTED",request,user.id);return NextResponse.json({error:"INVALID_CREDENTIALS"},{status:401})}if(user.role==="ADMIN"){await securityEvent("ADMIN_PASSWORD_ACCEPTED",request,user.id,undefined,{authenticationMethod:"PASSWORD"});if(user.administratorMfa?.enabledAt){await createLoginChallenge(user.id);return NextResponse.json({ok:true,mfaRequired:true})}const created=await createSession(user.id,request,{recent:true,authenticationMethod:"MFA_ENROLLMENT"});await securityEvent("ADMIN_SESSION_CREATED",request,user.id,undefined,{sessionId:created.id,authenticationMethod:"MFA_ENROLLMENT"});return NextResponse.json({ok:true,mfaEnrollmentRequired:true})}await createSession(user.id,request,{recent:true,authenticationMethod:"PASSWORD"});return NextResponse.json({ok:true})}catch(error){return apiError(error)}}
