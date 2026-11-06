import "server-only";
import type { Prisma } from "@/platform/host/generated/prisma/client";
import type { EmailMessage, EmailProvider } from "@/platform/email/contracts";

// Queueing never loads transport configuration, keeping security operations
// independent of outbound email. Delivery has one canonical implementation.
export type { EmailProvider } from "@/platform/email/contracts";
export const emailProvider: EmailProvider = Object.freeze({
  async send(message: EmailMessage) {
    const delivery = await import("@/apps/web/email");
    return delivery.emailProvider.send(message);
  },
});

export async function queueCommerceEmail(tx:Prisma.TransactionClient,input:{type:string;recipient:string;subject:string;payload:Record<string,unknown>;deduplicationKey?:string}){
  const data={...input,payload:input.payload as Prisma.InputJsonValue};
  if(input.deduplicationKey){await tx.emailOutbox.createMany({data:[data],skipDuplicates:true});return}
  await tx.emailOutbox.create({data});
}
export async function queueSecurityEmail(tx:Prisma.TransactionClient,input:{type:string;recipient:string;subject:string;deduplicationKey:string;payload?:Record<string,unknown>}){await tx.emailOutbox.createMany({data:[{...input,payload:(input.payload??{}) as Prisma.InputJsonValue}],skipDuplicates:true})}

export async function dispatchEmailOutbox(limit = 20, options: { workerId?: string; claimTtlMs?: number } = {}) {
  const delivery = await import("@/apps/web/email");
  return delivery.dispatchEmailOutbox(limit, options);
}
