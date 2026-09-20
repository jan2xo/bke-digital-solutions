const canonicalOrigin = process.env.APP_URL;
const secret = process.env.CRON_SECRET;
if (!canonicalOrigin || !secret) throw new Error("Certification APP_URL and CRON_SECRET are required");
const response = await fetch(new URL("/api/cron/email-outbox", canonicalOrigin), {
  method: "POST",
  headers: { authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Email outbox processing failed with HTTP ${response.status}`);
console.info("Certification email outbox processing completed.");

export {};
