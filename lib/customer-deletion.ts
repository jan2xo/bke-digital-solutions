import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";

export class CustomerDeletionError extends Error {
  constructor(public readonly code: "NOT_FOUND" | "FORBIDDEN" | "CONFIRMATION_MISMATCH") { super(code); }
}

export async function permanentlyDeleteCustomer(input: { customerId: string; actorId: string; confirmationEmail: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${input.customerId} FOR UPDATE`;
    const customer = await tx.user.findUnique({
      where: { id: input.customerId },
      include: { ownedAccounts: { select: { id: true, billingEmail: true } } },
    });
    if (!customer) throw new CustomerDeletionError("NOT_FOUND");
    if (customer.role === "ADMIN" || customer.id === input.actorId) throw new CustomerDeletionError("FORBIDDEN");
    if (input.confirmationEmail.trim().toLowerCase() !== customer.email.toLowerCase()) throw new CustomerDeletionError("CONFIRMATION_MISMATCH");

    const accountIds = customer.ownedAccounts.map((account) => account.id);
    const orderIds = accountIds.length ? (await tx.order.findMany({ where: { accountId: { in: accountIds } }, select: { id: true } })).map((order) => order.id) : [];
    const licenseIds = accountIds.length ? (await tx.license.findMany({ where: { accountId: { in: accountIds } }, select: { id: true } })).map((license) => license.id) : [];
    const billingEmails = [...new Set([customer.email, ...customer.ownedAccounts.map((account) => account.billingEmail)])];
    const summary = { accounts: accountIds.length, orders: orderIds.length, licenses: licenseIds.length };
    const relatedTargetIds = [customer.id, ...accountIds, ...orderIds, ...licenseIds];

    await tx.auditLog.deleteMany({ where: { OR: [
      { actorId: customer.id },
      { targetId: { in: relatedTargetIds } },
      ...(accountIds.length ? [{ accountId: { in: accountIds } }] : []),
    ] } });
    await tx.licenseAssignment.deleteMany({ where: { OR: [{ userId: customer.id }, ...(licenseIds.length ? [{ licenseId: { in: licenseIds } }] : [])] } });
    if (accountIds.length) await tx.trialGrant.deleteMany({ where: { accountId: { in: accountIds } } });
    if (licenseIds.length) await tx.license.deleteMany({ where: { id: { in: licenseIds } } });
    if (accountIds.length) await tx.subscription.deleteMany({ where: { accountId: { in: accountIds } } });
    if (orderIds.length) {
      await tx.invoice.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.payment.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (accountIds.length) {
      await tx.cart.deleteMany({ where: { accountId: { in: accountIds } } });
      await tx.invitation.deleteMany({ where: { accountId: { in: accountIds } } });
      await tx.membership.deleteMany({ where: { OR: [{ accountId: { in: accountIds } }, { userId: customer.id }] } });
      await tx.organizationProfile.deleteMany({ where: { accountId: { in: accountIds } } });
      await tx.customerAccount.deleteMany({ where: { id: { in: accountIds } } });
    } else {
      await tx.membership.deleteMany({ where: { userId: customer.id } });
    }
    await tx.passwordResetToken.deleteMany({ where: { userId: customer.id } });
    await tx.verificationToken.deleteMany({ where: { identifier: customer.email } });
    await tx.emailOutbox.deleteMany({ where: { recipient: { in: billingEmails } } });
    await tx.session.deleteMany({ where: { userId: customer.id } });
    await tx.passwordCredential.deleteMany({ where: { userId: customer.id } });
    await tx.user.delete({ where: { id: customer.id } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "CUSTOMER_PERMANENTLY_DELETED", targetType: "User", targetId: input.customerId, metadata: summary as Prisma.InputJsonValue } });
    return summary;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 30_000 });
}
