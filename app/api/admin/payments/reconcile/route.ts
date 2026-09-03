import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { apiError } from "@/v2/apps/web/http/api-error";
import { acknowledgeReconciliation, reconcileAndRecord } from "@/lib/reconciliation";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
const schema=z.discriminatedUnion("action",[z.object({action:z.literal("RUN"),orderId:z.string().cuid()}),z.object({action:z.literal("ACKNOWLEDGE"),reconciliationId:z.string().cuid(),confirmation:z.literal("ACKNOWLEDGE RECONCILIATION")})]);
export async function POST(request:Request){try{assertSameOrigin(request);const admin=await requireRecentAdmin();if(!(await rateLimit(`admin-reconcile:${admin.id}:${clientIp(request)}`,30,3600)).allowed)throw new Error("RATE_LIMITED");const input=schema.parse(await request.json());const result=input.action==="RUN"?await reconcileAndRecord(input.orderId,admin.id):await acknowledgeReconciliation(input.reconciliationId,admin.id);return NextResponse.json({ok:true,result})}catch(error){return apiError(error)}}
