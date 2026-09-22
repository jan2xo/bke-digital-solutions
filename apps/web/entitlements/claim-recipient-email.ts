import { z } from "zod";

const recipientEmailSchema = z.email().max(254);

export function normalizeClaimRecipientEmail(value: string): string {
  return recipientEmailSchema.parse(value.trim().toLowerCase());
}

export function validClaimRecipientEmail(value: string): boolean {
  return recipientEmailSchema.safeParse(value.trim().toLowerCase()).success;
}

export function claimRecipientMatches(expected: string | null, actual: string): boolean {
  if (!expected) return true;
  return normalizeClaimRecipientEmail(expected) === normalizeClaimRecipientEmail(actual);
}
