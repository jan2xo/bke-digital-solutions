const origin = process.env.INTERNAL_APP_URL;
const secret = process.env.CRON_SECRET;
const intervalMs = 60_000;
if (!origin || !secret) throw new Error("INTERNAL_APP_URL and CRON_SECRET are required for the scheduler worker");
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const response = await fetch(new URL("/api/cron/scheduler", origin), { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(55_000) });
    if (!response.ok) console.error(JSON.stringify({ event: "scheduler_tick_failed", status: response.status }));
  } catch (error) { console.error(JSON.stringify({ event: "scheduler_tick_failed", errorCode: error instanceof Error ? error.name : "UNKNOWN" })); }
  finally { running = false; }
}
await tick();
setInterval(tick, intervalMs);
