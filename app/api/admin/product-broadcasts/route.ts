import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireRecentAdmin } from "@/apps/web/auth/session";
import { apiError } from "@/apps/web/http/api-error";
import { assertSameOrigin } from "@/apps/web/http/request";
import {
  listProductBroadcasts,
  productBroadcastPublishInput,
  productBroadcastWithdrawInput,
  publishProductBroadcast,
  withdrawProductBroadcast,
} from "@/platform/notifications/product-broadcasts";

export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PUBLISH"), broadcast: productBroadcastPublishInput }).strict(),
  z.object({ action: z.literal("WITHDRAW"), broadcast: productBroadcastWithdrawInput }).strict(),
]);

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const productId = url.searchParams.get("productId") ?? undefined;
    const broadcasts = await listProductBroadcasts(productId);
    return NextResponse.json(
      { broadcasts },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const admin = await requireRecentAdmin();
    const input = requestSchema.parse(await request.json());

    if (input.action === "WITHDRAW") {
      const broadcast = await withdrawProductBroadcast(admin.id, input.broadcast);
      return NextResponse.json({ broadcast });
    }

    const broadcast = await publishProductBroadcast(admin.id, input.broadcast);
    return NextResponse.json({ broadcast }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
