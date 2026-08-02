import "server-only";
import { redirect } from "next/navigation";
import { pendingReacceptance } from "@/lib/legal/service";
export async function requireLegalClearance(userId: string, returnTo: string) { if ((await pendingReacceptance(userId)).length) redirect(`/legal/accept?returnTo=${encodeURIComponent(returnTo)}`); }

