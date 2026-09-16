import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/apps/web/auth/session";
import { db } from "@/platform/host/db";
import { apiError } from "@/apps/web/http/api-error";
import { assertSameOrigin } from "@/apps/web/http/request";
import { retryStoredWebhook } from "@/apps/web/payments/webhook-processing";
const schema=z.discriminatedUnion("action",[z.object({action:z.literal("RETRY")}),z.object({action:z.literal("ACKNOWLEDGE"),confirmation:z.literal("ACKNOWLEDGE WEBHOOK")})]);
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{assertSameOrigin(request);const admin=await requireRecentAdmin();const{id}=await params;const input=schema.parse(await request.json());if(input.action==="RETRY")return NextResponse.json({ok:true,result:await retryStoredWebhook(id)});const result=await db.$transaction(async tx=>{const row=await tx.webhookEvent.update({where:{id},data:{resolutionStatus:"ACKNOWLEDGED",resolutionCode:"ADMIN_REVIEWED",resolvedAt:new Date(),resolvedById:admin.id}});await tx.auditLog.create({data:{actorId:admin.id,action:"PAYMENT_WEBHOOK_ACKNOWLEDGED",targetType:"WebhookEvent",targetId:id,metadata:{provider:row.provider,eventType:row.eventType,lastErrorCode:row.lastErrorCode}}});return row});return NextResponse.json({ok:true,result})}catch(error){return apiError(error)}}
