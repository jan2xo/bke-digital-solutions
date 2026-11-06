import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { opaqueEntityIdSchema } from "@/apps/web/http/validation";
import { ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID, type AccountsPurchaseAccessCapability } from "@bke/accounts/contracts/purchase-access.contract";
import { COMMERCE_ORDER_SOURCE_LOOKUP_CAPABILITY_ID, type CommerceOrderSourceLookupCapability } from "@bke/commerce/contracts/order-source-lookup.contract";
import { LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID, type LegalReacceptanceStatusCapability } from "@bke/legal/contracts/reacceptance-status.contract";
import { requireIdentityUser } from "@/apps/web/auth/session";
import { apiError } from "@/apps/web/http/api-error";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/apps/web/http/request";
import { getV2WebApplication } from "@/apps/web/runtime";
import { checkoutBinding, findBoundPaymentIntentOrderById } from "@/apps/web/commerce/payment-intent-checkout";

const bodySchema = z.object({ orderId: opaqueEntityIdSchema, customerAccountId: opaqueEntityIdSchema }).strict();
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

class StatusHttpError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
function fail(code: string, status: number): never { throw new StatusHttpError(code, status); }

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const principal = await requireIdentityUser();
    if (!principal.emailVerified) fail("EMAIL_NOT_VERIFIED", 403);
    if (!(await rateLimit(`checkout-status:${principal.id}:${clientIp(request)}`, 60, 60)).allowed) {
      fail("RATE_LIMITED", 429);
    }
    let input: z.infer<typeof bodySchema>;
    try {
      input = bodySchema.parse(await request.json());
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) fail("INVALID_CHECKOUT", 422);
      throw error;
    }
    const application = await getV2WebApplication();
    const access = application.get<AccountsPurchaseAccessCapability>(ACCOUNTS_PURCHASE_ACCESS_CAPABILITY_ID);
    const authorized = await access.authorize({ principalId: principal.id, accountId: input.customerAccountId });
    if (authorized.status === "REJECTED") fail(authorized.code, authorized.code === "NOT_FOUND" ? 404 : 403);
    if (authorized.status === "FAILED") fail("ACCOUNT_UNAVAILABLE", 503);

    const reacceptance = application.get<LegalReacceptanceStatusCapability>(LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID);
    const current = await reacceptance.check({ principalId: principal.id, principalEstablishedAt: principal.establishedAt });
    if (current.status === "REACCEPTANCE_REQUIRED") fail("LEGAL_REACCEPTANCE_REQUIRED", 409);
    if (current.status === "FAILED") fail("LEGAL_DOCUMENTS_UNAVAILABLE", 503);

    const order = await findBoundPaymentIntentOrderById(input.orderId);
    const binding = order ? checkoutBinding(order) : null;
    if (!order || order.accountId !== authorized.account.id || !binding ||
      binding.principalId !== principal.id || binding.accountId !== authorized.account.id ||
      typeof binding.sourceReference !== "string") fail("NOT_FOUND", 404);
    const sourceLookup = application.get<CommerceOrderSourceLookupCapability>(COMMERCE_ORDER_SOURCE_LOOKUP_CAPABILITY_ID);
    const canonical = await sourceLookup.find({ sourceReference: binding.sourceReference });
    if (canonical.status === "FAILED") fail("COMMERCE_UNAVAILABLE", 503);
    if (canonical.status !== "FOUND" || canonical.value.orderId !== order.id ||
      canonical.value.accountId !== order.accountId || canonical.value.totalMinor !== order.totalMinor ||
      canonical.value.currency !== order.currency) fail("NOT_FOUND", 404);
    const status = canonical.value.status === "PAID" ? "PAID" :
      canonical.value.status === "CANCELLED" ? "CANCELLED" :
      canonical.value.status === "REFUNDED" || canonical.value.status === "PARTIALLY_REFUNDED" ? "REFUNDED" : "PENDING";
    return NextResponse.json({ orderId: order.id, status }, { headers: privateHeaders });
  } catch (error) {
    const protocol = error !== null && typeof error === "object"
      ? error as { code?: unknown; status?: unknown }
      : null;
    const safeProtocol = protocol && typeof protocol.code === "string" &&
      typeof protocol.status === "number" &&
      ((protocol.status === 401 && protocol.code === "UNAUTHENTICATED") ||
        (protocol.status === 403 && ["INVALID_ORIGIN", "RECENT_AUTH_REQUIRED"].includes(protocol.code)));
    const safeError = error instanceof StatusHttpError
      ? error
      : error instanceof Error && ["UNAUTHENTICATED", "INVALID_ORIGIN", "RECENT_AUTH_REQUIRED"].includes(error.message)
        ? error
        : error instanceof ZodError
        ? new StatusHttpError("INVALID_CHECKOUT", 422)
        : error instanceof SyntaxError
          ? new StatusHttpError("INVALID_CHECKOUT", 400)
          : safeProtocol
            ? error
            : new StatusHttpError("CHECKOUT_STATUS_UNAVAILABLE", 503);
    const response = apiError(safeError);
    response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
    response.headers.set("Vary", privateHeaders.Vary);
    return response;
  }
}
