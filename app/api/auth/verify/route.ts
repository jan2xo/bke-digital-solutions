import { NextResponse } from "next/server";
import { db } from "@/platform/host/db";
import { hashToken } from "@/platform/host/security/crypto";
import { getWebHostEnvironment } from "@/apps/web/config/environment";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 400 });
  }

  const hash = hashToken(token);
  const row = await db.verificationToken.findUnique({
    where: { tokenHash: hash },
  });
  if (
    !row
    || row.purpose !== "VERIFY_EMAIL"
    || row.usedAt
    || row.expiresAt < new Date()
  ) {
    return NextResponse.json({ error: "INVALID_TOKEN" }, { status: 400 });
  }

  const now = new Date();
  await db.$transaction([
    db.verificationToken.update({
      where: { id: row.id },
      data: { usedAt: now },
    }),
    db.user.update({
      where: { email: row.identifier },
      data: { emailVerified: now },
    }),
  ]);

  return NextResponse.redirect(
    new URL("/dashboard", getWebHostEnvironment().appUrl),
  );
}
