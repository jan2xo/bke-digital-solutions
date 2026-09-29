import "server-only";

import { randomInt } from "node:crypto";
import { Prisma } from "@/platform/persistence/generated/prisma/client";
import { db } from "@/platform/host/db";
import { hashToken } from "@/platform/host/security/crypto";
import { hashPassword } from "@/apps/web/auth/session";
import { sendNativeVerificationCode } from "@/apps/web/email";
import { recordLegalAcceptances } from "@/apps/web/legal/service";

const NATIVE_EMAIL_VERIFICATION_PURPOSE = "VERIFY_EMAIL_NATIVE";
const BROWSER_EMAIL_VERIFICATION_PURPOSE = "VERIFY_EMAIL";
const VERIFICATION_TTL_MS = 10 * 60_000;
const VERIFICATION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const VERIFICATION_CODE_LENGTH = 8;

export class NativeCustomerRegistrationError extends Error {
  constructor(
    readonly code:
      | "ACCOUNT_EXISTS"
      | "INVALID_VERIFICATION_CODE"
      | "ACCOUNT_NOT_ACTIVE",
  ) {
    super(code);
  }
}

export type NativeCustomerVerificationDelivery = Readonly<{
  recipientEmail: string;
  code: string;
}>;

function createVerificationCode(): string {
  let code = "";
  for (let index = 0; index < VERIFICATION_CODE_LENGTH; index += 1) {
    code += VERIFICATION_ALPHABET[
      randomInt(0, VERIFICATION_ALPHABET.length)
    ];
  }
  return code;
}

async function createNativeVerificationToken(
  email: string,
): Promise<NativeCustomerVerificationDelivery> {
  const code = createVerificationCode();
  const now = new Date();
  await db.$transaction([
    db.verificationToken.updateMany({
      where: {
        identifier: email,
        purpose: NATIVE_EMAIL_VERIFICATION_PURPOSE,
        usedAt: null,
      },
      data: { usedAt: now },
    }),
    db.verificationToken.create({
      data: {
        identifier: email,
        purpose: NATIVE_EMAIL_VERIFICATION_PURPOSE,
        tokenHash: hashToken(code),
        expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
      },
    }),
  ]);
  return { recipientEmail: email, code };
}

export async function registerNativeCustomer(input: {
  email: string;
  name: string;
  password: string;
  legalVersionIds: string[];
  request: Request;
}): Promise<NativeCustomerVerificationDelivery> {
  const existing = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) throw new NativeCustomerRegistrationError("ACCOUNT_EXISTS");

  const passwordHash = await hashPassword(input.password);
  const code = createVerificationCode();
  const now = new Date();

  try {
    await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          credential: { create: { passwordHash } },
          ownedAccounts: {
            create: {
              type: "INDIVIDUAL",
              displayName: input.name,
              billingEmail: input.email,
            },
          },
        },
        include: { ownedAccounts: true },
      });

      await recordLegalAcceptances(tx, {
        userId: created.id,
        customerAccountId: created.ownedAccounts[0]!.id,
        types: ["TERMS_OF_SERVICE", "PRIVACY_POLICY"],
        selectedVersionIds: input.legalVersionIds,
        context: "REGISTRATION",
        request: input.request,
      });

      await tx.verificationToken.create({
        data: {
          identifier: input.email,
          purpose: NATIVE_EMAIL_VERIFICATION_PURPOSE,
          tokenHash: hashToken(code),
          expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
        },
      });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2002"
    ) {
      throw new NativeCustomerRegistrationError("ACCOUNT_EXISTS");
    }
    throw error;
  }

  return { recipientEmail: input.email, code };
}

export async function resendNativeCustomerVerification(
  email: string,
): Promise<NativeCustomerVerificationDelivery | null> {
  const user = await db.user.findUnique({
    where: { email },
    select: { email: true, emailVerified: true, lifecycleState: true },
  });
  if (
    !user
    || user.emailVerified
    || user.lifecycleState !== "ACTIVE"
  ) {
    return null;
  }
  return createNativeVerificationToken(user.email);
}

export async function deliverNativeCustomerVerification(
  delivery: NativeCustomerVerificationDelivery,
): Promise<void> {
  await sendNativeVerificationCode(
    delivery.recipientEmail,
    delivery.code,
  );
}

export async function verifyNativeCustomerEmail(
  email: string,
  code: string,
): Promise<void> {
  const tokenHash = hashToken(code.trim().toUpperCase());

  const verified = await db.$transaction(async (tx) => {
    const now = new Date();
    const user = await tx.user.findUnique({
      where: { email },
      select: {
        id: true,
        emailVerified: true,
        lifecycleState: true,
      },
    });
    if (
      !user
      || user.emailVerified
      || user.lifecycleState !== "ACTIVE"
    ) {
      return false;
    }

    const token = await tx.verificationToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        identifier: true,
        purpose: true,
        usedAt: true,
        expiresAt: true,
      },
    });
    if (
      !token
      || token.identifier !== email
      || token.purpose !== NATIVE_EMAIL_VERIFICATION_PURPOSE
      || token.usedAt
      || token.expiresAt <= now
    ) {
      return false;
    }

    const consumed = await tx.verificationToken.updateMany({
      where: {
        id: token.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) return false;

    await tx.verificationToken.updateMany({
      where: {
        identifier: email,
        purpose: {
          in: [
            BROWSER_EMAIL_VERIFICATION_PURPOSE,
            NATIVE_EMAIL_VERIFICATION_PURPOSE,
          ],
        },
        usedAt: null,
      },
      data: { usedAt: now },
    });

    const updated = await tx.user.updateMany({
      where: {
        id: user.id,
        emailVerified: null,
        lifecycleState: "ACTIVE",
      },
      data: { emailVerified: now },
    });
    return updated.count === 1;
  });

  if (!verified) {
    throw new NativeCustomerRegistrationError(
      "INVALID_VERIFICATION_CODE",
    );
  }
}
