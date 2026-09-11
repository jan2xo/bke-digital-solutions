import {
  PAYMENTS_RECONCILIATION_CAPABILITY_ID,
  type PaymentsReconciliationCapability,
} from "@bke/payments/contracts/reconciliation.contract";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/lib/auth";
import { audit } from "@/v2/apps/web/audit";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { getV2WebApplication } from "@/v2/apps/web/runtime";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("RUN"), orderId: z.string().cuid() }),
  z.object({
    action: z.literal("ACKNOWLEDGE"),
    reconciliationId: z.string().uuid(),
    confirmation: z.literal("ACKNOWLEDGE RECONCILIATION"),
  }),
]);

class ReconciliationHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

function fail(code: string, status: number): never {
  throw new ReconciliationHttpError(code, status);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    if (!(await rateLimit(`admin-reconcile:${admin.id}:${clientIp(request)}`, 30, 3600)).allowed) {
      throw new Error("RATE_LIMITED");
    }

    const input = schema.parse(await request.json());
    const application = await getV2WebApplication();
    const reconciliation = application.get<PaymentsReconciliationCapability>(
      PAYMENTS_RECONCILIATION_CAPABILITY_ID,
    );

    if (input.action === "RUN") {
      const result = await reconciliation.run({
        commercialReference: input.orderId,
        runById: admin.id,
      });

      if (result.status === "REJECTED") fail("PAYMENT_NOT_FOUND", 404);
      if (result.status === "FAILED") {
        if (result.code === "INVALID_INPUT") fail("INVALID_INPUT", 400);
        if (result.code === "PROVIDER_UNAVAILABLE") fail("PAYMENT_PROVIDER_UNAVAILABLE", 503);
        fail("INTERNAL_ERROR", 503);
      }

      await audit({
        actorId: admin.id,
        action: "PAYMENT_RECONCILIATION_RUN",
        targetType: "Order",
        targetId: input.orderId,
        metadata: {
          correlationId: result.value.correlationId,
          classification: result.value.classification,
          differences: result.value.differences,
        },
      });

      return NextResponse.json({ ok: true, result: result.value });
    }

    const result = await reconciliation.acknowledge({
      reconciliationId: input.reconciliationId,
      actorId: admin.id,
    });

    if (result.status === "REJECTED") fail("NOT_FOUND", 404);
    if (result.status === "FAILED") {
      if (result.code === "INVALID_INPUT") fail("INVALID_INPUT", 400);
      fail("INTERNAL_ERROR", 503);
    }

    await audit({
      actorId: admin.id,
      action: "PAYMENT_RECONCILIATION_ACKNOWLEDGED",
      targetType: "PaymentReconciliation",
      targetId: result.value.reconciliationId,
      metadata: {
        classification: result.value.classification,
        correlationId: result.value.correlationId,
      },
    });

    return NextResponse.json({ ok: true, result: result.value });
  } catch (error) {
    return apiError(error);
  }
}
