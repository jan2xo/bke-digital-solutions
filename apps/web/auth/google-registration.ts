import "server-only";

import { Prisma } from "@/platform/persistence/generated/prisma/client";
import { db } from "@/platform/host/db";
import { hashToken, randomToken } from "@/platform/host/security/crypto";
import { recordLegalAcceptances } from "@/apps/web/legal/service";
import { REGISTRATION_LEGAL_TYPES } from "@bke/legal/logic/document-catalog";
import {
  IDENTITY_GOOGLE_PRINCIPAL_BINDING_CAPABILITY_ID,
  type IdentityGooglePrincipalBindingCapability,
} from "@bke/identity/contracts/google-identity.contract";
import { createIdentityGooglePrincipalBindingCapability } from "@bke/identity/logic/google-identity";
import { createPrismaTransactionGoogleIdentityRepository } from "@/modules/identity/google-transaction-repository";

export class GoogleRegistrationError extends Error {
  constructor(
    readonly code:
      | "ACCOUNT_EXISTS"
      | "EMAIL_REQUIRED"
      | "EMAIL_NOT_VERIFIED"
      | "LEGAL_ACCEPTANCE_REQUIRED"
      | "GOOGLE_SUBJECT_ALREADY_BOUND"
      | "ACCOUNT_NOT_ACTIVE",
  ) {
    super(code);
  }
}

export async function registerGoogleCustomer(input: {
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly legalVersionIds: readonly string[];
  readonly request: Request;
}) {
  if (!input.email) throw new GoogleRegistrationError("EMAIL_REQUIRED");
  if (!input.emailVerified) throw new GoogleRegistrationError("EMAIL_NOT_VERIFIED");

  const existing = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) throw new GoogleRegistrationError("ACCOUNT_EXISTS");

  const token = randomToken();
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email!,
          name: input.name,
          role: "CUSTOMER",
          ownedAccounts: {
            create: {
              type: "INDIVIDUAL",
              displayName: input.name || input.email!,
              billingEmail: input.email!,
            },
          },
        },
        include: { ownedAccounts: true },
      });

      await recordLegalAcceptances(tx, {
        userId: created.id,
        customerAccountId: created.ownedAccounts[0]!.id,
        types: [...REGISTRATION_LEGAL_TYPES],
        selectedVersionIds: [...input.legalVersionIds],
        context: "REGISTRATION",
        request: input.request,
      });

      await tx.verificationToken.create({
        data: {
          identifier: input.email!,
          purpose: "VERIFY_EMAIL",
          tokenHash: hashToken(token),
          expiresAt,
        },
      });

      const repository = createPrismaTransactionGoogleIdentityRepository(tx);
      const binding: IdentityGooglePrincipalBindingCapability =
        createIdentityGooglePrincipalBindingCapability(repository);
      const result = await binding.bindToUser({
        userId: created.id,
        subject: input.subject,
      });
      if (result.status === "REJECTED") {
        if (result.code === "SUBJECT_ALREADY_BOUND" || result.code === "USER_ALREADY_BOUND") {
          throw new GoogleRegistrationError("GOOGLE_SUBJECT_ALREADY_BOUND");
        }
        throw new GoogleRegistrationError("ACCOUNT_NOT_ACTIVE");
      }
      if (result.status === "FAILED") throw new Error(result.code);

      return { user: created, verificationToken: token };
    });
  } catch (error) {
    if (error instanceof GoogleRegistrationError) throw error;
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new GoogleRegistrationError("ACCOUNT_EXISTS");
    }
    throw error;
  }
}
