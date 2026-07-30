import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/security/crypto";
export async function GET(request:Request){const token=new URL(request.url).searchParams.get("token");if(!token)return NextResponse.json({error:"INVALID_TOKEN"},{status:400});const hash=hashToken(token);const row=await db.verificationToken.findUnique({where:{tokenHash:hash}});if(!row||row.usedAt||row.expiresAt<new Date())return NextResponse.json({error:"INVALID_TOKEN"},{status:400});await db.$transaction([db.verificationToken.update({where:{id:row.id},data:{usedAt:new Date()}}),db.user.update({where:{email:row.identifier},data:{emailVerified:new Date()}})]);return NextResponse.redirect(new URL("/dashboard",request.url))}
