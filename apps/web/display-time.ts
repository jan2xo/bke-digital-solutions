/**
 * Convert a wall-clock date-time entered as Philippine Standard Time into
 * an absolute UTC ISO instant. This function does not change how timestamps
 * are stored, signed, compared, audited or transmitted by the server.
 *
 * Philippine Standard Time is UTC+08:00 year-round, without DST.
 */
export function philippineDateTimeLocalToIso(value: string): string {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error("INVALID_PHILIPPINE_DATETIME_LOCAL");
  }
  const instant = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(instant.getTime())) {
    throw new Error("INVALID_PHILIPPINE_DATETIME_LOCAL");
  }
  // Reject calendar overflow such as February 30 instead of silently normalizing.
  const localRoundTrip = new Date(instant.getTime() + 8 * 60 * 60 * 1000)
    .toISOString().slice(0, 16);
  if (localRoundTrip !== value) {
    throw new Error("INVALID_PHILIPPINE_DATETIME_LOCAL");
  }
  return instant.toISOString();
}
