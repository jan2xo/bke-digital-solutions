import "server-only";
import { db } from "@/lib/db";
import { paymentProvider } from "@/lib/payments";
import { PaymentLifecycleError, safePaymentError } from "@/lib/payments/errors";
import type { PaymentProvider, RefundInput } from "@/lib/payments/types";

export async function requestFullRefund(input:{orderId:string;requestedById:string;reason:RefundInput["reason"];notes?:string},provider:PaymentProvider=paymentProvider){
  if(!provider.createRefund)throw new PaymentLifecycleError("PAYMENT_REFUND_NOT_ALLOWED");
  const order=await db.order.findUnique({where:{id:input.orderId},include:{payments:{where:{provider:provider.name,status:"PAID"},orderBy:{createdAt:"desc"},take:1}}});
  const payment=order?.payments[0];
  if(!order||order.status!=="PAID"||!payment)throw new PaymentLifecycleError("PAYMENT_REFUND_NOT_ALLOWED");
  const idempotencyKey=`refund:${payment.id}:full`;
  const existing=await db.refundOperation.findUnique({where:{idempotencyKey}});
  if(existing)return existing;
  const operation=await db.$transaction(async tx=>{
    const row=await tx.refundOperation.create({data:{orderId:order.id,paymentId:payment.id,provider:provider.name,amountMinor:payment.amountMinor,currency:payment.currency,reasonCode:input.reason,idempotencyKey,status:"REQUESTED",requestedById:input.requestedById}});
    await tx.auditLog.create({data:{actorId:input.requestedById,accountId:order.accountId,action:"PAYMENT_REFUND_REQUESTED",targetType:"RefundOperation",targetId:row.id,metadata:{orderId:order.id,paymentId:payment.id,amountMinor:payment.amountMinor,currency:payment.currency,reason:input.reason}}});
    return row;
  });
  try{
    const result=await provider.createRefund({paymentId:payment.externalId,amountMinor:payment.amountMinor,reason:input.reason,notes:input.notes,idempotencyKey});
    return await db.refundOperation.update({where:{id:operation.id},data:{externalRefundId:result.externalId,status:result.status==="succeeded"?"PROVIDER_CONFIRMED":result.status.toUpperCase(),completedAt:result.status==="failed"?new Date():null,lastErrorCode:result.status==="failed"?"PAYMENT_REFUND_NOT_ALLOWED":null}});
  }catch(error){
    const code=safePaymentError(error);
    await db.refundOperation.update({where:{id:operation.id},data:{status:"FAILED",lastErrorCode:code,completedAt:new Date()}});
    throw error;
  }
}
