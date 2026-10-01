import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "bke-gift-claim-v1_";
const HANDLE_PATTERN = /^bke-gift-claim-v1_[0-9a-f]{64}$/;

export function giftClaimHandle(
  claimCodeId: string,
  purchaserAccountId: string,
  pepper: string,
): string {
  const claim = claimCodeId.trim();
  const account = purchaserAccountId.trim();
  const secret = pepper.trim();
  if (!claim || !account || !secret) throw new Error("INVALID_GIFT_CLAIM_HANDLE_INPUT");
  const digest = createHmac("sha256", secret)
    .update("bke-gift-claim-v1\0", "utf8")
    .update(account, "utf8")
    .update("\0", "utf8")
    .update(claim, "utf8")
    .digest("hex");
  return `${PREFIX}${digest}`;
}

export function validGiftClaimHandle(value: string): boolean {
  return HANDLE_PATTERN.test(value.trim());
}

export function giftClaimHandleMatches(
  candidateHandle: string,
  claimCodeId: string,
  purchaserAccountId: string,
  pepper: string,
): boolean {
  const candidate = candidateHandle.trim();
  if (!validGiftClaimHandle(candidate)) return false;
  const expected = giftClaimHandle(
    claimCodeId,
    purchaserAccountId,
    pepper,
  );
  return timingSafeEqual(
    Buffer.from(candidate, "utf8"),
    Buffer.from(expected, "utf8"),
  );
}
