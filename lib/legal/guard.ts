import "server-only";
import { redirect } from "next/navigation";
import { pendingReacceptance } from "@/v2/apps/web/legal/service";
export async function requireLegalClearance(userId: string, returnTo: string) { if ((await pendingReacceptance(userId)).length) redirect(`/legal/accept?returnTo=${encodeURIComponent(returnTo)}`); }

