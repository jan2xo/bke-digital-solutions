import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security/request";
import { retryStoredWebhook } from "@/lib/webhooks";
const schema=z.discriminatedUnion("action",[z.object({action:z.literal("RETRY")}),z.object({action:z.literal("ACKNOWLEDGE"),confirmation:z.literal("ACKNOWLEDGE WEBHOOK")})]);
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{assertSameOrigin(request);const admin=await requireRecentAdmin();const{id}=await params;const input=schema.parse(await request.json());if(input.action==="RETRY")return NextResponse.json({ok:true,result:await retryStoredWebhook(id)});const result=await db.$transaction(async tx=>{const row=await tx.webhookEvent.update({where:{id},data:{resolutionStatus:"ACKNOWLEDGED",resolutionCode:"ADMIN_REVIEWED",resolvedAt:new Date(),resolvedById:admin.id}});await tx.auditLog.create({data:{actorId:admin.id,action:"PAYMENT_WEBHOOK_ACKNOWLEDGED",targetType:"WebhookEvent",targetId:id,metadata:{provider:row.provider,eventType:row.eventType,lastErrorCode:row.lastErrorCode}}});return row});return NextResponse.json({ok:true,result})}catch(error){return apiError(error)}}
