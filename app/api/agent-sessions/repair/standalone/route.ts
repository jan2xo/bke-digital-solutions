import { NextResponse } from "next/server";
import { valid } from "semver";
import { z } from "zod";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import { authenticateAgentAccessToken } from "@/apps/web/agent-sessions/device-authorization";
import { issueAgentAccountRepairPolicy } from "@/apps/web/agent-sessions/repair-policy-issuer";
import { readAgentSoftwareCatalog } from "@/apps/web/catalog/agent-software-catalog";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { githubReleaseRepository } from "@/platform/distribution/github-releases";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const requestSchema = z.object({
  product_id: z.string().trim().min(1).max(128),
  current_version: z.string().trim().min(1).max(64),
  channel: z.literal("stable"),
  platform: z.enum(["windows", "macos", "linux"]),
  architecture: z.enum(["x64", "arm64", "x86"]),
}).strict();

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() || null;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-bke-account-session-version": AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
    },
  });
}

export async function POST(request: Request) {
  try {
    const runtime = getRuntimeEnvironment();
    if (!runtime.AGENT_ACCOUNT_SESSION_ENABLED) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    rejectBrowserOriginForAgent(request);
    requireAgentAccountSessionProtocol(request);

    const accessToken = bearerToken(request);
    if (!accessToken) {
      return json({ error: "INVALID_TOKEN" }, 401);
    }
    if (!(await rateLimit(
      `agent-session:standalone-repair:${clientIp(request)}`,
      120,
      3600,
    )).allowed) {
      return json({ error: "RATE_LIMITED" }, 429);
    }

    const input = requestSchema.parse(await request.json());
    if (!valid(input.current_version)) {
      return json({ error: "INVALID_CURRENT_VERSION" }, 422);
    }

    const authority = await db.$transaction(async (tx) => {
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
      const product = products.find((item) => item.productId === input.product_id);
      if (!product) return { status: "not_found" as const };
      if (!product.entitled) return { status: "not_entitled" as const };
      if (product.executionType !== "STANDALONE") {
        return { status: "not_standalone" as const };
      }

      const repository = githubReleaseRepository(product.productId);
      if (!repository) {
        return { status: "distribution_unavailable" as const };
      }

      return {
        status: "repair_authorized" as const,
        productId: product.productId,
        repairVersion: input.current_version,
        repository,
        platform: input.platform,
        architecture: input.architecture,
      };
    }, { isolationLevel: "Serializable" });

    switch (authority.status) {
      case "invalid_token":
        return json({ error: "INVALID_TOKEN" }, 401);
      case "not_found":
        return json({ status: "not_found" }, 404);
      case "not_entitled":
        return json({ status: "not_entitled" }, 403);
      case "not_standalone":
        return json({ status: "unsupported_execution_type" }, 409);
      case "distribution_unavailable":
        return json({ status: "distribution_unavailable" }, 409);
      case "repair_authorized": {
        const policy = await issueAgentAccountRepairPolicy({
          productId: authority.productId,
          repairVersion: authority.repairVersion,
          platform: authority.platform,
          architecture: authority.architecture,
          repository: authority.repository,
        });
        return json({
          status: "repair_authorized",
          policy,
        });
      }
    }
  } catch (error) {
    return apiError(error);
  }
}
