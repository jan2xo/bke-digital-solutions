import { nativePasswordAuthRetired } from "@/apps/web/auth/retired-auth";

export async function POST() {
  return nativePasswordAuthRetired();
}
