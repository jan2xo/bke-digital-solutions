import { NextResponse } from "next/server";
import { z } from "zod";
import {
  IDENTITY_PASSWORD_AUTHENTICATION_CAPABILITY_ID,
  type IdentityPasswordAuthenticationCapability,
} from "@bke/identity/contracts/identity.contract";
import {
  AGENT_ACCOUNT_SESSION_PROTOCOL_VERSION,
  rejectBrowserOriginForAgent,
  requireAgentAccountSessionProtocol,
} from "@/apps/web/agent-sessions/contract";
import {
  issueNativeBkeAgentHandoff,
  resolveNativeBkeAccounts,
} from "@/apps/web/agent-sessions/native-handoff";
import { emailSchema } from "@/apps/web/http/validation";
import { apiError } from "@/apps/web/http/api-error";
import { clientIp } from "@/apps/web/http/request";
import { rateLimit } from "@/apps/web/http/rate-limit";
import { getV2WebApplication } from "@/apps/web/runtime";
import { db } from "@/platform/host/db";
import { getRuntimeEnvironment } from "@/platform/host/env";

const schema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  customer_account_id: z.string().min(1).max(256).optional(),
  device_id: z.string().regex(/^[A-Za-z0-9._:-]{16,256}$/),
  device_name: z.string().trim().min(1).max(128).optional(),
  platform: z.enum(["windows", "macos", "linux"]),
  architecture: z.enum(["x64", "arm64", "x86"]),
}).strict();

function response(body: unknown, status = 200) {
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

    const input = schema.parse(await request.json());
    const ip = clientIp(request);

    if (
      !(await rateLimit(`native-bke-login:${ip}:${input.email}`, 8, 900)).allowed
      || !(await rateLimit(
        `native-bke-login:device:${input.device_id.slice(-16)}`,
        12,
        900,
      )).allowed
    ) {
      return response({ error: "RATE_LIMITED" }, 429);
    }

    const application = await getV2WebApplication();
    const passwordAuthentication =
      application.get<IdentityPasswordAuthenticationCapability>(
        IDENTITY_PASSWORD_AUTHENTICATION_CAPABILITY_ID,
      );
    const authenticated = await passwordAuthentication.authenticate({
      email: input.email,
      password: input.password,
    });

    if (authenticated.status === "INVALID_CREDENTIALS") {
      return response({ error: "INVALID_CREDENTIALS" }, 401);
    }
    if (authenticated.status === "FAILED") {
      return response({ error: "AUTHENTICATION_UNAVAILABLE" }, 503);
    }
    if (
      authenticated.route !== "CUSTOMER_SESSION"
      || authenticated.principal.role !== "CUSTOMER"
    ) {
      return response({ error: "FORBIDDEN" }, 403);
    }
    if (!authenticated.principal.emailVerified) {
      return response({ error: "EMAIL_NOT_VERIFIED" }, 403);
    }
    if (authenticated.principal.lifecycleState !== "ACTIVE") {
      return response({ error: "ACCOUNT_NOT_ACTIVE" }, 403);
    }

    const result = await db.$transaction(async (tx) => {
      const accounts = await resolveNativeBkeAccounts(
        tx,
        authenticated.principal.id,
      );

      if (!input.customer_account_id && accounts.length !== 1) {
        return {
          status: "account_selection_required" as const,
          accounts,
        };
      }

      const accountId = input.customer_account_id ?? accounts[0]?.id;
      if (!accountId) {
        return {
          status: "account_selection_required" as const,
          accounts,
        };
      }

      const handoff = await issueNativeBkeAgentHandoff(tx, {
        principal: authenticated.principal,
        accountId,
        deviceId: input.device_id,
        deviceName: input.device_name,
        platform: input.platform,
        architecture: input.architecture,
        pepper: runtime.AGENT_ACCOUNT_SESSION_PEPPER!,
      });
      return {
        status: "handoff_issued" as const,
        handoff,
      };
    }, { isolationLevel: "Serializable" });

    if (result.status === "account_selection_required") {
      return response({
        status: result.status,
        accounts: result.accounts.map((account) => ({
          account_id: account.id,
          account_type: account.type,
          account_display_name: account.displayName,
        })),
      });
    }

    return response({
      status: "handoff_issued",
      handoff_code: result.handoff.handoffCode,
      expires_in: result.handoff.expiresIn,
      account: {
        account_id: result.handoff.account.id,
        account_type: result.handoff.account.type,
        account_display_name: result.handoff.account.displayName,
      },
    }, 201);
  } catch (error) {
    return apiError(error);
  }
}
