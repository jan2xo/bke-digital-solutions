import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { hashToken } from "@/lib/security/crypto";
import { env } from "@/lib/env";
import { securityEvent } from "@/lib/security/events";
export async function GET(request:Request){const token=new URL(request.url).searchParams.get("token");if(!token)return NextResponse.json({error:"INVALID_TOKEN"},{status:400});const row=await db.verificationToken.findUnique({where:{tokenHash:hashToken(token)}});if(!row||row.purpose!=="MAGIC_LOGIN"||row.usedAt||row.expiresAt<new Date())return NextResponse.json({error:"INVALID_TOKEN"},{status:400});const user=await db.user.findUnique({where:{email:row.identifier}});if(!user)return NextResponse.json({error:"INVALID_TOKEN"},{status:400});if(user.role==="ADMIN"){await securityEvent("ADMIN_MAGIC_LOGIN_BLOCKED",request,user.id);return NextResponse.redirect(new URL("/login?error=ADMIN_PASSWORD_REQUIRED",env.APP_URL))}await db.verificationToken.update({where:{id:row.id},data:{usedAt:new Date()}});await createSession(user.id,request);return NextResponse.redirect(new URL("/dashboard",env.APP_URL))}
