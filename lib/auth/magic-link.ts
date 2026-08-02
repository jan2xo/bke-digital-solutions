import "server-only";
import { db } from "@/lib/db";
import { sendMagicLink } from "@/lib/email";
import { hashToken, randomToken } from "@/lib/security/crypto";

export async function issueMagicLinkForExistingCustomer(email: string) {
  const user = await db.user.findFirst({
    where: { email, role: "CUSTOMER" },
    select: { id: true },
  });
  if (!user) return false;

  const token = randomToken();
  const now = new Date();
  await db.$transaction([
    db.verificationToken.updateMany({
      where: { identifier: email, purpose: "MAGIC_LOGIN", usedAt: null },
      data: { usedAt: now },
    }),
    db.verificationToken.create({
      data: {
        identifier: email,
        purpose: "MAGIC_LOGIN",
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + 15 * 60_000),
      },
    }),
  ]);
  await sendMagicLink(email, token);
  return true;
}
