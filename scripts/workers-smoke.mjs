import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

const origin = "http://127.0.0.1:8787";
let ready = false;
for (let attempt = 0; attempt < 90; attempt++) {
  try {
    const response = await fetch(origin + "/api/health/live", { signal: AbortSignal.timeout(2000) });
    if (response.ok) { ready = true; break; }
  } catch {}
  await setTimeout(1000);
}
assert.ok(ready, "Actual application did not start in workerd");
for (let invocation = 0; invocation < 2; invocation++) {
  const response = await fetch(origin + "/", { signal: AbortSignal.timeout(15000) });
  const html = await response.text();
  assert.equal(response.status, 200, "Dynamic application browse failed; digest=" + (html.match(/"digest"\\s*:\\s*"([^"]+)"/)?.[1] ?? "unavailable"));
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
}
const login = await fetch(origin + "/login", { signal: AbortSignal.timeout(15000) });
assert.equal(login.status, 200);
assert.match(await login.text(), /google/i);
const retired = await fetch(origin + "/api/auth/login", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "fixture@example.invalid", password: "retired" }),
});
assert.equal(retired.status, 410, "Retired password login must remain retired");
console.log("PASS: workerd public receiving checks");
console.log("NOT VERIFIED: real Google sign-in, native handoff, deployed Free CPU limits");

const { readFile } = await import("node:fs/promises");
const { promisify } = await import("node:util");
const { execFile } = await import("node:child_process");
const sessions = JSON.parse(await readFile(".certification-secrets/workers-sessions.json", "utf8"));
for (let invocation = 0; invocation < 2; invocation++) {
  await Promise.all(sessions.map(async (session, index) => {
    const response = await fetch(origin + "/dashboard", {
      headers: { cookie: "__Host-bke_session=" + session.token },
      redirect: "manual", signal: AbortSignal.timeout(15000),
    });
    const html = await response.text();
    assert.equal(response.status, 200, "Authenticated dashboard failed");
    assert.ok(html.includes(session.name), "Own principal missing");
    assert.ok(!html.includes(sessions[1 - index].name), "Cross-account data exposure");
  }));
}
await promisify(execFile)(process.execPath, [
  "node_modules/tsx/dist/cli.mjs", "scripts/workers-fixture.ts", "revoke",
], { env: { ...process.env, NODE_OPTIONS: "--conditions=react-server" } });
const revoked = await fetch(origin + "/dashboard", {
  headers: { cookie: "__Host-bke_session=" + sessions[0].token }, redirect: "manual",
});
assert.ok([303, 307].includes(revoked.status), "Revoked session was accepted");
assert.match(revoked.headers.get("location") ?? "", /\/login/);
await revoked.text();
console.log("PASS: concurrent authenticated dashboards, repeat invocations, fresh session revocation");
