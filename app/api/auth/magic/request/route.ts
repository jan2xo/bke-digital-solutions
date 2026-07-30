import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emailSchema } from "@/lib/validation";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { randomToken, hashToken } from "@/lib/security/crypto";
import { sendMagicLink } from "@/lib/email";
export async function POST(request:Request){assertSameOrigin(request);const email=emailSchema.parse((await request.json()).email);if(!(await rateLimit(`magic:${clientIp(request)}:${email}`,5,3600)).allowed)return NextResponse.json({ok:true});const user=await db.user.findUnique({where:{email}});if(user){const token=randomToken();await db.verificationToken.create({data:{identifier:email,purpose:"MAGIC_LOGIN",tokenHash:hashToken(token),expiresAt:new Date(Date.now()+15*60_000)}});await sendMagicLink(email,token)}return NextResponse.json({ok:true})}
