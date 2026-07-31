import "server-only";
import { addDays, addMonths, addYears } from "@/lib/time";
import { encryptLicenseKey, generateLicenseKey, hashLicenseKey } from "@/lib/security/crypto";
import type { Prisma } from "@/generated/prisma/client";

export async function issueEntitlements(tx: Prisma.TransactionClient, orderId: string) {
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
        await tx.license.updateMany({where:{subscriptionId:existing.id},data:{status:"ACTIVE",expiresAt:end}});
        const licenses=await tx.license.findMany({where:{subscriptionId:existing.id},select:{id:true}});for(const license of licenses)await tx.licenseEvent.create({data:{licenseId:license.id,type:"RENEWED",metadata:{orderId,discountedCycle:consumeDiscount}}});
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
