import "server-only";
import { Prisma, type DiscountOffer } from "@/generated/prisma/client";
import { applyOfferDiscount, PRICING_VERSION } from "@/lib/pricing";

export type OfferPlanContext = { id:string; type:"PERPETUAL"|"MONTHLY"|"ANNUAL"; editionId:string; productId:string; currency:string };

export function normalizeOfferCode(value:string){return value.trim().toUpperCase()}

export function assertOfferConfiguration(offer:{type:string;discountBps:number;customerAccountId?:string|null;discountedBillingCycles?:number|null;purchasePlanType?:string|null;allowZeroTotal?:boolean}){
  if(!Number.isInteger(offer.discountBps)||offer.discountBps<0||offer.discountBps>10_000)throw new Error("INVALID_OFFER_DISCOUNT");
  if((offer.type==="CUSTOMER_ACCOUNT_OFFER"||offer.type==="ADMINISTRATIVE_ADJUSTMENT")&&!offer.customerAccountId)throw new Error("OFFER_ACCOUNT_REQUIRED");
  if(offer.discountedBillingCycles!==null&&offer.discountedBillingCycles!==undefined){
    if(!Number.isInteger(offer.discountedBillingCycles)||offer.discountedBillingCycles<1||offer.discountedBillingCycles>12)throw new Error("INVALID_PROMOTIONAL_DURATION");
    if(offer.purchasePlanType&&offer.purchasePlanType!=="MONTHLY")throw new Error("INVALID_PROMOTIONAL_DURATION");
  }
  if(offer.allowZeroTotal&&offer.discountBps!==10_000)throw new Error("ZERO_TOTAL_REQUIRES_FULL_DISCOUNT");
}

export function offerMatches(offer:DiscountOffer,plan:OfferPlanContext,accountId:string,now=new Date()){
  if(offer.status!=="ACTIVE"||offer.revokedAt||offer.startsAt>now||(offer.endsAt&&offer.endsAt<=now))return false;
  if(offer.customerAccountId&&offer.customerAccountId!==accountId)return false;
  if(offer.productId&&offer.productId!==plan.productId)return false;
  if(offer.editionId&&offer.editionId!==plan.editionId)return false;
  if(offer.purchasePlanId&&offer.purchasePlanId!==plan.id)return false;
  if(offer.discountedBillingCycles&&plan.type!=="MONTHLY")return false;
  return true;
}

export async function resolveAndReserveOffer(tx:Prisma.TransactionClient,input:{identifier:string;accountId:string;orderId:string;plan:OfferPlanContext;catalogAmountMinor:number}){
  const normalized=normalizeOfferCode(input.identifier);
  const candidate=await tx.discountOffer.findFirst({where:{OR:[{id:input.identifier},{codeNormalized:normalized}]}});
  if(!candidate)throw new Error("OFFER_NOT_FOUND");
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "DiscountOffer" WHERE id = ${candidate.id} FOR UPDATE`);
  const offer=await tx.discountOffer.findUniqueOrThrow({where:{id:candidate.id}});
  if(!offerMatches(offer,input.plan,input.accountId))throw new Error("OFFER_NOT_FOUND");
  const usedStatuses=["RESERVED","APPLIED","REFUNDED"] as const;
  const [total,accountTotal]=await Promise.all([
    tx.offerRedemption.count({where:{offerId:offer.id,status:{in:[...usedStatuses]}}}),
    tx.offerRedemption.count({where:{offerId:offer.id,accountId:input.accountId,status:{in:[...usedStatuses]}}}),
  ]);
  if(offer.maximumRedemptions!==null&&total>=offer.maximumRedemptions)throw new Error("OFFER_LIMIT_REACHED");
  if(offer.perAccountRedemptionLimit!==null&&accountTotal>=offer.perAccountRedemptionLimit)throw new Error("OFFER_ACCOUNT_LIMIT_REACHED");
  const discounted=applyOfferDiscount(input.catalogAmountMinor,offer.discountBps);
  if(discounted.finalAmountMinor===0){
    if(!offer.allowZeroTotal)throw new Error("ZERO_TOTAL_NOT_AUTHORIZED");
    if(input.plan.type==="PERPETUAL"&&offer.type==="GENERAL_PROMOTION")throw new Error("ZERO_TOTAL_NOT_AUTHORIZED");
  }
  await tx.offerRedemption.create({data:{offerId:offer.id,accountId:input.accountId,orderId:input.orderId,status:"RESERVED",discountBps:offer.discountBps,baseMinor:input.catalogAmountMinor,discountMinor:discounted.discountAmountMinor,finalMinor:discounted.finalAmountMinor,currency:input.plan.currency,pricingVersion:PRICING_VERSION}});
  return {offer, ...discounted};
}

export function offerSnapshot(offer:DiscountOffer,discountAmountMinor:number){return{id:offer.id,name:offer.name,code:offer.codeNormalized,type:offer.type,scope:offer.purchasePlanId?"PURCHASE_PLAN":offer.editionId?"EDITION":offer.productId?"PRODUCT":offer.customerAccountId?"CUSTOMER_ACCOUNT":"ALL_ELIGIBLE",discountBps:offer.discountBps,discountAmountMinor,discountedBillingCycles:offer.discountedBillingCycles}}
