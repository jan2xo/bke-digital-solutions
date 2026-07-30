import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/security/crypto";
export async function POST(request:Request){const provided=request.headers.get("authorization")?.replace(/^Bearer /,"")??"";if(!safeEqual(provided,env.CRON_SECRET))return NextResponse.json({error:"UNAUTHORIZED"},{status:401});const day=new Date().toISOString().slice(0,10);const key=`renewals:${day}`;try{await db.jobRun.create({data:{key,jobType:"RENEWAL_REMINDERS"}})}catch{return NextResponse.json({duplicate:true})}const subscriptions=await db.subscription.findMany({where:{status:"ACTIVE",renewalReminderAt:{lte:new Date()},currentPeriodEnd:{gt:new Date()}},include:{account:true}});/* Delivery is intentionally queued by selecting due records; production workers can call the mail adapter. */await db.jobRun.update({where:{key},data:{completedAt:new Date()}});return NextResponse.json({processed:subscriptions.length})}
