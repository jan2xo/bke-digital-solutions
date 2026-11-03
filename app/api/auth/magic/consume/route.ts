import { NextResponse } from "next/server";
import { getWebHostEnvironment } from "@/apps/web/config/environment";

export async function GET() {
  return NextResponse.redirect(new URL("/login?error=GOOGLE_SIGN_IN_REQUIRED", getWebHostEnvironment().appUrl));
}
