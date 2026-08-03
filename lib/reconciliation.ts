import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { paymentProvider } from "@/lib/payments";
import { PaymentLifecycleError } from "@/lib/payments/errors";
import type { PaymentProvider, ProviderPayment } from "@/lib/payments/types";

export type ReconciliationResult = { orderId: string; paymentId: string; matched: boolean; differences: string[]; classification: string; localStatus: string; providerStatus: string };

export function classifyPayment(local:{status:string;amountMinor:number;currency:string;externalId:string;order:{status:string;totalMinor:number;currency:string}},remote:ProviderPayment,expectedLivemode:boolean){
  const differences:string[]=[];
  if(remote.externalId!==local.externalId)differences.push("external_id");
  if(remote.amountMinor!==local.amountMinor||remote.amountMinor!==local.order.totalMinor)differences.push("amount");
  if(remote.currency.toUpperCase()!==local.currency.toUpperCase()||remote.currency.toUpperCase()!==local.order.currency.toUpperCase())differences.push("currency");
  if(remote.livemode!==expectedLivemode)differences.push("mode");
  const expected=local.status==="PAID"?"paid":local.status==="FAILED"?"failed":local.status==="REFUNDED"?"refunded":"pending";
  if(remote.status!==expected)differences.push("status");
  const classification=differences.includes("amount")?"AMOUNT_MISMATCH":differences.includes("currency")?"CURRENCY_MISMATCH":differences.includes("mode")?"MODE_MISMATCH":differences.length===0?"MATCHED":`LOCAL_${local.order.status}_PROVIDER_${remote.status.toUpperCase()}`;
  return{differences,classification,matched:differences.length===0};
}

export async function reconcilePayment(orderId:string,provider:PaymentProvider=paymentProvider):Promise<ReconciliationResult>{
  if(!provider.retrievePayment)throw new PaymentLifecycleError("PAYMENT_RECONCILIATION_REQUIRED");
  const local=await db.payment.findFirst({where:{orderId,provider:provider.name},include:{order:true},orderBy:{createdAt:"desc"}});
  if(!local)throw new Error("PAYMENT_NOT_FOUND");
  let remote:ProviderPayment;
  try{remote=await provider.retrievePayment(local.externalId)}catch{throw new PaymentLifecycleError("PAYMENT_PROVIDER_UNAVAILABLE",true)}
  const result=classifyPayment(local,remote,process.env.PAYMONGO_LIVEMODE==="true");
  return{orderId,paymentId:local.id,providerStatus:remote.status,localStatus:`${local.order.status}/${local.status}`,...result};
}

export async function reconcileAndRecord(orderId:string,runById:string,provider:PaymentProvider=paymentProvider){
  const correlationId=`reconcile:${randomUUID()}`;
  try{
    const result=await reconcilePayment(orderId,provider);
    return await db.$transaction(async tx=>{
      const row=await tx.paymentReconciliation.create({data:{orderId,paymentId:result.paymentId,provider:provider.name,classification:result.classification,differences:result.differences as Prisma.InputJsonValue,localStatus:result.localStatus,providerStatus:result.providerStatus,status:result.matched?"MATCHED":"OPEN",correlationId,runById}});
      await tx.auditLog.create({data:{actorId:runById,action:"PAYMENT_RECONCILIATION_RUN",targetType:"Order",targetId:orderId,metadata:{correlationId,classification:result.classification,differences:result.differences}}});
      return row;
    });
  }catch(error){
    const order=await db.order.findUnique({where:{id:orderId},select:{id:true,status:true}});if(!order)throw error;
    await db.paymentReconciliation.create({data:{orderId,provider:provider.name,classification:"PROVIDER_UNAVAILABLE",differences:[] as Prisma.InputJsonValue,localStatus:order.status,status:"OPEN",correlationId,lastErrorCode:"PAYMENT_PROVIDER_UNAVAILABLE",runById}});
    throw error;
  }
}

export async function acknowledgeReconciliation(id:string,actorId:string){
  return db.$transaction(async tx=>{const row=await tx.paymentReconciliation.update({where:{id},data:{status:"ACKNOWLEDGED",acknowledgedAt:new Date(),acknowledgedById:actorId}});await tx.auditLog.create({data:{actorId,action:"PAYMENT_RECONCILIATION_ACKNOWLEDGED",targetType:"PaymentReconciliation",targetId:id,metadata:{classification:row.classification,correlationId:row.correlationId}}});return row});
}
