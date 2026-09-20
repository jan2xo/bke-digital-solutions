export function renewalExpiration(currentExpiry: Date | null | undefined, effectiveAt: Date, durationMs: number) {
  const base = currentExpiry && currentExpiry.getTime() > effectiveAt.getTime() ? currentExpiry : effectiveAt;
  return new Date(base.getTime() + durationMs);
}
