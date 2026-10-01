import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { db } from "@/platform/host/db";
import { getAgentAccountBillingHistory } from "@/apps/web/accounts/agent-account-billing-history";

describe("Agent account billing history", () => {
  it("projects selected-account invoices and payments by Accounts role without cloud identifiers", async () => {
    const suffix = `${Date.now().toString(36)}-${process.pid}`;

    async function makeUser(label: string) {
      return db.user.create({
        data: {
          email: `${label}-${suffix}@bke.test`,
          name: label,
          emailVerified: new Date(),
        },
      });
    }

    const owner = await makeUser("billing-owner");
    const billing = await makeUser("billing-role");
    const licenseManager = await makeUser("billing-license");
    const member = await makeUser("billing-member");
    const outsider = await makeUser("billing-outsider");
    const otherOwner = await makeUser("billing-other-owner");

    const account = await db.customerAccount.create({
      data: {
        type: "ORGANIZATION",
        displayName: "Billing History Certification",
        ownerId: owner.id,
        billingEmail: owner.email,
        organization: {
          create: {
            legalName: "Billing History Certification Legal",
          },
        },
        memberships: {
          create: [
            { userId: owner.id, role: "OWNER" },
            { userId: billing.id, role: "BILLING" },
            { userId: licenseManager.id, role: "LICENSE_MANAGER" },
            { userId: member.id, role: "MEMBER" },
          ],
        },
      },
    });

    const otherAccount = await db.customerAccount.create({
      data: {
        type: "INDIVIDUAL",
        displayName: "Other Billing Account",
        ownerId: otherOwner.id,
        billingEmail: otherOwner.email,
      },
    });

    const order = await db.order.create({
      data: {
        number: `ORD-BILLING-${suffix}`,
        accountId: account.id,
        status: "PAID",
        currency: "PHP",
        subtotalMinor: 30000000,
        taxMinor: 0,
        totalMinor: 30000000,
        billingSnapshot: {
          certification: true,
          secret: "billing-snapshot-must-not-leak",
        },
        paidAt: new Date("2026-10-01T01:00:00.000Z"),
      },
    });

    const otherOrder = await db.order.create({
      data: {
        number: `ORD-BILLING-OTHER-${suffix}`,
        accountId: otherAccount.id,
        status: "PAID",
        currency: "PHP",
        subtotalMinor: 1000000,
        taxMinor: 0,
        totalMinor: 1000000,
        billingSnapshot: { certification: true },
        paidAt: new Date("2026-10-01T01:30:00.000Z"),
      },
    });

    await db.invoice.create({
      data: {
        number: `INV-BILLING-${suffix}`,
        orderId: order.id,
        status: "FINAL",
        customerSnapshot: {
          certification: true,
          secret: "customer-snapshot-must-not-leak",
        },
        currency: "PHP",
        subtotalMinor: 30000000,
        taxMinor: 0,
        totalMinor: 30000000,
        issuedAt: new Date("2026-10-01T01:05:00.000Z"),
        lines: {
          create: [
            {
              description: "Render Dock · Pro · Annual",
              quantity: 1,
              unitAmountMinor: 30000000,
              totalMinor: 30000000,
            },
          ],
        },
      },
    });

    await db.invoice.create({
      data: {
        number: `INV-BILLING-OTHER-${suffix}`,
        orderId: otherOrder.id,
        status: "FINAL",
        customerSnapshot: { certification: true },
        currency: "PHP",
        subtotalMinor: 1000000,
        taxMinor: 0,
        totalMinor: 1000000,
        issuedAt: new Date("2026-10-01T01:35:00.000Z"),
      },
    });

    await db.payment.create({
      data: {
        orderId: order.id,
        provider: "provider-cert-must-not-leak",
        externalId: `external-payment-cert-${suffix}`,
        status: "PAID",
        amountMinor: 30000000,
        currency: "PHP",
        paidAt: new Date("2026-10-01T01:00:00.000Z"),
      },
    });

    await db.payment.create({
      data: {
        orderId: otherOrder.id,
        provider: "other-provider-cert-must-not-leak",
        externalId: `external-payment-other-${suffix}`,
        status: "PAID",
        amountMinor: 1000000,
        currency: "PHP",
        paidAt: new Date("2026-10-01T01:30:00.000Z"),
      },
    });

    try {
      const ownerHistory = await getAgentAccountBillingHistory({
        principalId: owner.id,
        accountId: account.id,
      });
      assert.equal(ownerHistory.status, "ready");
      if (ownerHistory.status !== "ready") {
        throw new Error("owner billing history missing");
      }

      assert.deepEqual(ownerHistory.permissions, {
        viewInvoices: true,
        viewPayments: true,
      });
      assert.equal(ownerHistory.invoices.length, 1);
      assert.equal(ownerHistory.payments.length, 1);
      assert.equal(
        ownerHistory.invoices[0]?.number,
        `INV-BILLING-${suffix}`,
      );
      assert.equal(
        ownerHistory.invoices[0]?.orderNumber,
        `ORD-BILLING-${suffix}`,
      );
      assert.equal(ownerHistory.invoices[0]?.lines.length, 1);
      assert.equal(
        ownerHistory.payments[0]?.orderNumber,
        `ORD-BILLING-${suffix}`,
      );
      assert.equal(ownerHistory.payments[0]?.status, "PAID");

      const ownerWire = JSON.stringify(ownerHistory);
      for (const forbidden of [
        order.id,
        otherOrder.id,
        "provider-cert-must-not-leak",
        `external-payment-cert-${suffix}`,
        "billing-snapshot-must-not-leak",
        "customer-snapshot-must-not-leak",
      ]) {
        assert.equal(
          ownerWire.includes(forbidden),
          false,
          `billing history leaked forbidden value: ${forbidden}`,
        );
      }
      assert.equal(
        Object.hasOwn(ownerHistory.invoices[0] ?? {}, "id"),
        false,
      );
      assert.equal(
        Object.hasOwn(ownerHistory.payments[0] ?? {}, "id"),
        false,
      );
      assert.equal(
        Object.hasOwn(ownerHistory.payments[0] ?? {}, "provider"),
        false,
      );
      assert.equal(
        Object.hasOwn(ownerHistory.payments[0] ?? {}, "externalId"),
        false,
      );

      const billingHistory = await getAgentAccountBillingHistory({
        principalId: billing.id,
        accountId: account.id,
      });
      assert.equal(billingHistory.status, "ready");
      if (billingHistory.status !== "ready") {
        throw new Error("billing-role history missing");
      }
      assert.deepEqual(billingHistory.permissions, {
        viewInvoices: true,
        viewPayments: true,
      });
      assert.equal(billingHistory.invoices.length, 1);
      assert.equal(billingHistory.payments.length, 1);

      const licenseHistory = await getAgentAccountBillingHistory({
        principalId: licenseManager.id,
        accountId: account.id,
      });
      assert.equal(licenseHistory.status, "ready");
      if (licenseHistory.status !== "ready") {
        throw new Error("license-manager billing history missing");
      }
      assert.deepEqual(licenseHistory.permissions, {
        viewInvoices: false,
        viewPayments: false,
      });
      assert.equal(licenseHistory.invoices.length, 0);
      assert.equal(licenseHistory.payments.length, 0);

      const memberHistory = await getAgentAccountBillingHistory({
        principalId: member.id,
        accountId: account.id,
      });
      assert.equal(memberHistory.status, "ready");
      if (memberHistory.status !== "ready") {
        throw new Error("member billing history missing");
      }
      assert.deepEqual(memberHistory.permissions, {
        viewInvoices: false,
        viewPayments: false,
      });
      assert.equal(memberHistory.invoices.length, 0);
      assert.equal(memberHistory.payments.length, 0);

      const outsiderHistory = await getAgentAccountBillingHistory({
        principalId: outsider.id,
        accountId: account.id,
      });
      assert.deepEqual(outsiderHistory, { status: "forbidden" });

      const otherHistory = await getAgentAccountBillingHistory({
        principalId: otherOwner.id,
        accountId: otherAccount.id,
      });
      assert.equal(otherHistory.status, "ready");
      if (otherHistory.status !== "ready") {
        throw new Error("other selected-account history missing");
      }
      assert.equal(otherHistory.invoices.length, 1);
      assert.equal(otherHistory.payments.length, 1);
      assert.equal(
        otherHistory.invoices[0]?.number,
        `INV-BILLING-OTHER-${suffix}`,
      );
      assert.equal(
        otherHistory.invoices[0]?.number ===
          ownerHistory.invoices[0]?.number,
        false,
      );
    } finally {
      await db.payment.deleteMany({
        where: {
          order: {
            accountId: { in: [account.id, otherAccount.id] },
          },
        },
      });
      await db.invoiceLine.deleteMany({
        where: {
          invoice: {
            order: {
              accountId: { in: [account.id, otherAccount.id] },
            },
          },
        },
      });
      await db.invoice.deleteMany({
        where: {
          order: {
            accountId: { in: [account.id, otherAccount.id] },
          },
        },
      });
      await db.order.deleteMany({
        where: {
          accountId: { in: [account.id, otherAccount.id] },
        },
      });
      await db.customerAccount.deleteMany({
        where: {
          id: { in: [account.id, otherAccount.id] },
        },
      });
      await db.user.deleteMany({
        where: {
          id: {
            in: [
              owner.id,
              billing.id,
              licenseManager.id,
              member.id,
              outsider.id,
              otherOwner.id,
            ],
          },
        },
      });
    }
  });
});
