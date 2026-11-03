import { passwordAuthRetired } from "@/apps/web/auth/retired-auth";

export async function POST() {
  return passwordAuthRetired();
}
