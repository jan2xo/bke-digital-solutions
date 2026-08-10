import "server-only";
import { addDays, addMonths, addYears } from "@/lib/time";
import { encryptLicenseKey, generateLicenseKey, hashLicenseKey } from "@/lib/security/crypto";
import type { Prisma } from "@/generated/prisma/client";
import { renewalExpiration } from "@/lib/licensing/renewal";

export type RenewalLeaseRequest = { operationId: string; licenseId: string; deviceHash: string };

export async function issueEntitlements(tx: Prisma.TransactionClient, orderId: string, evidence?: { paymentId?: string; paymentEventId?: string }, renewalRequests?: RenewalLeaseRequest[]) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  const plaintextKeys: string[] = [];
  for (const item of order.items) {
    const policy = item.policySnapshot as { maxSeats: number; maxDevicesPerSeat: number; validityDays?: number };
    let subscriptionId: string | undefined;
    let expiresAt = policy.validityDays ? addDays(new Date(), policy.validityDays) : undefined;
    if (item.billingType === "SUBSCRIPTION") {
      let intervalUnit = item.intervalUnit;
      let intervalCount = item.intervalCount ?? 1;
      if (!intervalUnit) {
        const legacyPrice = await tx.price.findUniqueOrThrow({ where: { id: item.priceId } });
        intervalUnit = legacyPrice.intervalUnit;
        intervalCount = legacyPrice.intervalCount ?? 1;
      }
      const existing=order.renewalSubscriptionId?await tx.subscription.findUniqueOrThrow({where:{id:order.renewalSubscriptionId}}):null;
      const start=existing?.currentPeriodEnd&&existing.currentPeriodEnd>new Date()?existing.currentPeriodEnd:new Date();
      const end = intervalUnit === "YEAR" ? addYears(start, intervalCount) : addMonths(start, intervalCount);
      if(existing){
        const consumeDiscount=Boolean(item.offerId&&existing.discountedCyclesTotal&&existing.discountedCyclesConsumed<existing.discountedCyclesTotal);
        await tx.subscription.update({where:{id:existing.id},data:{status:"ACTIVE",currentPeriodStart:start,currentPeriodEnd:end,renewalReminderAt:addDays(end,intervalUnit==="MONTH"?-7:-30),discountedCyclesConsumed:consumeDiscount?{increment:1}:undefined}});
        const licenses=await tx.license.findMany({where:{subscriptionId:existing.id},select:{id:true,expiresAt:true,activations:{where:{active:true},select:{deviceHash:true}}}});
        await tx.license.updateMany({where:{subscriptionId:existing.id},data:{status:"ACTIVE",expiresAt:end}});
        for(const license of licenses){
          const operationBase = `renewal:${order.id}:${license.id}`;
          const effectiveExpiry = renewalExpiration(license.expiresAt, new Date(), end.getTime() - start.getTime());
          const hasBinding=license.activations.length>0;
          if (hasBinding) {
            for (const activation of license.activations) {
              const operationId = `${operationBase}:${activation.deviceHash}`;
              await tx.commercialLeaseOperation.upsert({ where:{operationId}, create:{operationId,licenseId:license.id,action:"RENEWAL",status:"PREPARED",metadata:{orderId,paymentId:evidence?.paymentId,paymentEventId:evidence?.paymentEventId,oldExpiry:license.expiresAt?.toISOString()??null,newExpiry:effectiveExpiry.toISOString(),durationMs:end.getTime()-start.getTime(),decision:"SUCCESSOR_LEASE_PENDING",deviceHash:activation.deviceHash}}, update:{} });
              renewalRequests?.push({operationId,licenseId:license.id,deviceHash:activation.deviceHash});
            }
          } else {
            const operationId = `${operationBase}:none`;
            await tx.commercialLeaseOperation.upsert({ where:{operationId}, create:{operationId,licenseId:license.id,action:"RENEWAL",status:"COMPLETED",metadata:{orderId,paymentId:evidence?.paymentId,paymentEventId:evidence?.paymentEventId,oldExpiry:license.expiresAt?.toISOString()??null,newExpiry:effectiveExpiry.toISOString(),durationMs:end.getTime()-start.getTime(),decision:"ENTITLEMENT_RENEWED_NO_ACTIVE_INSTALLATION"},completedAt:new Date()}, update:{} });
          }
          await tx.licenseEvent.create({data:{licenseId:license.id,type:"RENEWED",metadata:{orderId,discountedCycle:consumeDiscount,renewalOperationId:operationBase,oldExpiry:license.expiresAt?.toISOString()??null,newExpiry:effectiveExpiry.toISOString()}}});
        }
        continue;
      }
      const pricing=(item.pricingSnapshot??{}) as {catalogAmountMinor?:number;finalAmountMinor?:number;offer?:{discountBps?:number;discountedBillingCycles?:number}};
      const subscription = await tx.subscription.create({ data: {
        accountId: order.accountId,
        orderId,
        productId: item.productId,
        editionId: item.editionId,
        purchasePlanId: item.purchasePlanId,
        status: "ACTIVE",
        seats: item.quantity * policy.maxSeats,
        currentPeriodStart: new Date(),
        currentPeriodEnd: end,
        renewalReminderAt: addDays(end, intervalUnit === "MONTH" ? -7 : -30),
        currency:order.currency,normalRecurringAmountMinor:pricing.catalogAmountMinor??item.unitAmountMinor,discountedRecurringAmountMinor:pricing.offer?pricing.finalAmountMinor:null,promotionalDiscountBps:pricing.offer?.discountBps,discountedCyclesTotal:pricing.offer?.discountedBillingCycles,discountedCyclesConsumed:pricing.offer?.discountedBillingCycles?1:0,offerId:item.offerId,offerSnapshot:pricing.offer as Prisma.InputJsonValue|undefined,pricingVersion:item.pricingVersion,
      } });
      subscriptionId = subscription.id;
      expiresAt = end;
    }
    const key = generateLicenseKey();
    plaintextKeys.push(key);
    await tx.license.create({ data: {
      publicId: crypto.randomUUID(),
      keyHash: hashLicenseKey(key),
      keyLastFour: key.slice(-4),
      keyCiphertext: encryptLicenseKey(key),
      accountId: order.accountId,
      orderId,
      orderItemId: item.id,
      productId: item.productId,
      editionId: item.editionId,
      purchasePlanId: item.purchasePlanId,
      subscriptionId,
      maxSeats: item.quantity * policy.maxSeats,
      maxDevicesPerSeat: policy.maxDevicesPerSeat,
      expiresAt,
      events: { create: { type: "ISSUED", metadata: { orderId, editionId: item.editionId, purchasePlanId: item.purchasePlanId, planType: item.planType } } },
    } });
  }
  return plaintextKeys;
}
