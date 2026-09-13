import {
  LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID,
  type LegalReacceptanceStatusCapability,
} from "@bke/legal/contracts/reacceptance-status.contract";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createOrganizationAccount,
  listSwitchableAccounts,
} from "@/v2/apps/web/accounts/organization-operations";
import { requireIdentityUser } from "@/v2/apps/web/auth/session";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertSameOrigin } from "@/v2/apps/web/http/request";
import { getV2WebApplication } from "@/v2/apps/web/runtime";

const createSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120),
    legalName: z.string().trim().min(2).max(180),
    billingEmail: z.string().trim().email(),
    registrationNumber: z.string().trim().max(80).optional(),
    taxId: z.string().trim().max(80).optional(),
  })
  .strict();

class OrganizationHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

async function assertLegalCurrent(principal: {
  id: string;
  establishedAt: Date;
}): Promise<void> {
  const application = await getV2WebApplication();
  const reacceptance = application.get<LegalReacceptanceStatusCapability>(
    LEGAL_REACCEPTANCE_STATUS_CAPABILITY_ID,
  );
  const result = await reacceptance.check({
    principalId: principal.id,
    principalEstablishedAt: principal.establishedAt,
  });
  if (result.status === "REACCEPTANCE_REQUIRED") {
    throw new OrganizationHttpError("LEGAL_REACCEPTANCE_REQUIRED", 409);
  }
  if (result.status === "FAILED") {
    throw new OrganizationHttpError(
      result.code === "PERSISTENCE_UNAVAILABLE" ? "LEGAL_DOCUMENTS_UNAVAILABLE" : "INVALID_INPUT",
      result.code === "PERSISTENCE_UNAVAILABLE" ? 503 : 422,
    );
  }
}

export async function GET() {
  try {
    const principal = await requireIdentityUser();
    const accounts = await listSwitchableAccounts(principal.id);
    return NextResponse.json(
      accounts.map((account) => ({
        id: account.id,
        type: account.type,
        displayName: account.displayName,
        lifecycleState: account.lifecycleState,
        role: account.effectiveRole,
      })),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const principal = await requireIdentityUser();
    if (!principal.emailVerified) throw new OrganizationHttpError("EMAIL_NOT_VERIFIED", 403);
    await assertLegalCurrent(principal);
    const input = createSchema.parse(await request.json());
    const account = await createOrganizationAccount({ actorId: principal.id, ...input });
    return NextResponse.json({ id: account.id }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
