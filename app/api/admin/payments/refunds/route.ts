import {
  PAYMENTS_REFUND_INITIATION_CAPABILITY_ID,
  type PaymentsRefundInitiationCapability,
} from "@bke/payments/contracts/refund-initiation.contract";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/v2/apps/web/auth/session";
import { audit } from "@/v2/apps/web/audit";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { getV2WebApplication } from "@/v2/apps/web/runtime";

const schema=z.object({orderId:z.string().cuid(),orderNumber:z.string().min(1).max(80),confirmation:z.string().max(100),reason:z.enum(["requested_by_customer","duplicate","fraudulent","other"]),notes:z.string().trim().max(500).optional()});

class RefundHttpError extends Error {
  constructor(readonly code:string,readonly status:number){super(code)}
}
function fail(code:string,status:number):never{throw new RefundHttpError(code,status)}

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const admin=await requireRecentAdmin();
    if(!(await rateLimit(`admin-refund:${admin.id}:${clientIp(request)}`,10,3600)).allowed)throw new Error("RATE_LIMITED");
    const input=schema.parse(await request.json());
    if(input.confirmation!==`REFUND ${input.orderNumber}`)throw new Error("REFUND_CONFIRMATION_REQUIRED");

    const application=await getV2WebApplication();
    const refunds=application.get<PaymentsRefundInitiationCapability>(PAYMENTS_REFUND_INITIATION_CAPABILITY_ID);
    const result=await refunds.initiateFullByCommercialReference({
      sourceReference:`admin-full-refund:${input.orderId}`,
      commercialReference:input.orderId,
      reason:input.reason,
      notes:input.notes,
    });

    if(result.status==="REJECTED"){
      if(result.code==="SOURCE_CONFLICT")fail("PAYMENT_REFUND_CONFLICT",409);
      fail("PAYMENT_REFUND_NOT_ALLOWED",409);
    }
    if(result.status==="FAILED"){
      if(result.code==="INVALID_INPUT")fail("INVALID_INPUT",400);
      if(result.code==="PROVIDER_UNAVAILABLE")fail("PAYMENT_PROVIDER_UNAVAILABLE",503);
      fail("INTERNAL_ERROR",503);
    }

    await audit({
      actorId:admin.id,
      action:"PAYMENT_REFUND_REQUESTED",
      targetType:"PaymentRefundOperation",
      targetId:result.value.refundOperationId,
      metadata:{
        orderId:input.orderId,
        provider:result.value.provider,
        amountMinor:result.value.amountMinor,
        currency:result.value.currency,
        reason:input.reason,
        disposition:result.disposition,
      },
    });

    return NextResponse.json({ok:true,result:result.value});
  }catch(error){
    return apiError(error);
  }
}
