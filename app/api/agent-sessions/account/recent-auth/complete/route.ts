import { nativeSecurityMutationRetired } from "@/apps/web/auth/retired-auth";

export async function POST() {
  return nativeSecurityMutationRetired();
}
