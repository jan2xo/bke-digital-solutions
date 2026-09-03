import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { apiError } from "@/v2/apps/web/http/api-error";
import { requestFullRefund } from "@/lib/refunds";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
const schema=z.object({orderId:z.string().cuid(),orderNumber:z.string().min(1).max(80),confirmation:z.string().max(100),reason:z.enum(["requested_by_customer","duplicate","fraudulent","other"]),notes:z.string().trim().max(500).optional()});
export async function POST(request:Request){try{assertSameOrigin(request);const admin=await requireRecentAdmin();if(!(await rateLimit(`admin-refund:${admin.id}:${clientIp(request)}`,10,3600)).allowed)throw new Error("RATE_LIMITED");const input=schema.parse(await request.json());if(input.confirmation!==`REFUND ${input.orderNumber}`)throw new Error("REFUND_CONFIRMATION_REQUIRED");const result=await requestFullRefund({...input,requestedById:admin.id});return NextResponse.json({ok:true,result})}catch(error){return apiError(error)}}
