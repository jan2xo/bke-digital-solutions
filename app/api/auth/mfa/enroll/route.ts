import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { requireAdminEnrollmentSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { securityEvent } from "@/lib/security/events";
import { encryptMfaSecret, generateTotpSecret, totpUri } from "@/lib/security/mfa";
import { rateLimit } from "@/lib/security/rate-limit";
import { assertSameOrigin, clientIp } from "@/lib/security/request";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireAdminEnrollmentSession();
    if (!session.recentAuthenticatedAt || session.recentAuthenticatedAt < new Date(Date.now() - 15 * 60_000)) throw new Error("RECENT_AUTH_REQUIRED");
    if (!(await rateLimit(`mfa-enroll:${session.userId}:${clientIp(request)}`, 5, 900)).allowed) throw new Error("RATE_LIMITED");
    if (session.user.administratorMfa?.enabledAt) throw new Error("MFA_ALREADY_ENABLED");
    const secret = generateTotpSecret();
    const uri = totpUri(session.user.email, secret);
    await db.administratorMfaMethod.upsert({
      where: { userId: session.userId },
      create: { userId: session.userId, encryptedSecret: encryptMfaSecret(secret), pendingExpiresAt: new Date(Date.now() + 10 * 60_000) },
      update: { encryptedSecret: encryptMfaSecret(secret), pendingExpiresAt: new Date(Date.now() + 10 * 60_000), enabledAt: null, verifiedAt: null, disabledAt: null },
    });
    await securityEvent("MFA_ENROLLMENT_STARTED", request, session.userId);
    return NextResponse.json({ secret, otpauthUri: uri, qrDataUrl: await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 1, width: 240 }), issuer: "BKE Digital Solutions", accountLabel: session.user.email });
  } catch (error) { return apiError(error); }
}
