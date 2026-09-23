import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateAgentAccessToken } from "@/apps/web/agent-sessions/device-authorization";
import { readAgentSoftwareCatalog } from "@/apps/web/catalog/agent-software-catalog";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const querySchema = z.object({
  platform: z.enum(["windows", "macos", "linux"]),
  architecture: z.enum(["x64", "arm64", "x86"]),
}).strict();

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

export async function GET(request: Request) {
  try {
    const runtime = getRuntimeEnvironment();
    if (!runtime.V3_AGENT_ACCOUNT_SESSION_ENABLED) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);

    const accessToken = bearerToken(request);
    if (!accessToken) {
      return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 401 });
    }

    if (!(await rateLimit(`agent-session:catalog:${clientIp(request)}`, 300, 3600)).allowed) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    }

    const url = new URL(request.url);
    const input = querySchema.parse({
      platform: url.searchParams.get("platform"),
      architecture: url.searchParams.get("architecture"),
    });

    const result = await db.$transaction(async (tx) => {
      const session = await authenticateAgentAccessToken(tx, {
        accessToken,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      });
      if (session.status !== "authenticated") {
        return { status: "invalid_token" as const };
      }

      const products = await readAgentSoftwareCatalog(tx, {
        accountId: session.accountId,
        userId: session.userId,
        platform: input.platform,
        architecture: input.architecture,
      });

      return {
        status: "ok" as const,
        accountId: session.accountId,
        products,
      };
    }, { isolationLevel: "Serializable" });

    if (result.status !== "ok") {
      return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 401 });
    }

    return NextResponse.json({
      status: "ok",
      account_id: result.accountId,
      products: result.products.map((product) => ({
        product_id: product.productId,
        display_name: product.displayName,
        summary: product.summary,
        execution_type: product.executionType,
        entitled: product.entitled,
        installable: product.installable,
        latest_version: product.latestVersion,
      })),
    }, {
      headers: {
        "cache-control": "no-store",
        "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
