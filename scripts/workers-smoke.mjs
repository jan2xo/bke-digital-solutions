import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";

const origin = "http://127.0.0.1:8787";
const imageUrl = "https://raw.githubusercontent.com/jan2xo/bke-digital-solutions/e60c5762ff40d2e2afdcf52dc2cc06ff2d1aa905/public/bke-icon.png";
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
  const csp = response.headers.get("content-security-policy") ?? "";
  const imgSrc = csp.split(";").map((directive) => directive.trim()).find((directive) => directive.startsWith("img-src "));
  assert.ok(imgSrc, "Content Security Policy must define img-src");
  const imgSources = imgSrc.split(/\s+/).slice(1);
  assert.ok(imgSources.includes("https:") || imgSources.includes("https://raw.githubusercontent.com"), "CSP must authorize GitHub image delivery");
  // Exercise the real Next.js application rendered in disposable workerd, not
  // a static HTML prototype. Auth and checkout implementations are unchanged.
  assert.match(html, /One platform\./, "Sonnet hero headline not rendered");
  assert.match(html, /Every BKE/, "Sonnet hero second line missing");
  assert.match(html, /Continue with Google/, "Anonymous Google entry missing");
  assert.match(html, /property="og:title"/, "Open Graph title metadata missing");
  assert.match(html, /property="og:image"/, "Open Graph image metadata missing");
  assert.match(html, /name="twitter:card"/, "Twitter card metadata missing");
  assert.match(html, /href="\/products"[^>]*>Explore\s*<span[^>]*aria-hidden="true"[^>]*>→<\/span><\/a>/, "Public Explore arrow CTA missing");
  assert.doesNotMatch(html, /<header\b[^>]*class="site-header"/, "Anonymous homepage must not show account navigation");
  assert.doesNotMatch(html, /<a\b[^>]*href="mailto:/, "Anonymous homepage exposes a Contact CTA");
  assert.match(html, /href="\/legal\/privacy-policy"/, "Required published Privacy link missing");
  assert.ok([...html.matchAll(/<img\b[^>]*>/g)].some((match) => match[0].includes(`src="${imageUrl}"`)),
    "Sonnet homepage must render a real GitHub-hosted catalog image");

}
// Validate real SEO route responses in workerd, not just source-file presence.
const robotsResponse = await fetch(origin + "/robots.txt", { signal: AbortSignal.timeout(15000) });
assert.equal(robotsResponse.status, 200, "Public robots.txt unavailable");
assert.match(robotsResponse.headers.get("content-type") ?? "", /text\/plain/);
const robotsText = await robotsResponse.text();
assert.match(robotsText, /Sitemap: https:\/\/bkedigitalsolutions\.com\/sitemap\.xml/);
assert.match(robotsText, /Disallow: \/admin/);
assert.match(robotsText, /Disallow: \/checkout/);

const sitemapResponse = await fetch(origin + "/sitemap.xml", { signal: AbortSignal.timeout(15000) });
assert.equal(sitemapResponse.status, 200, "Public sitemap.xml unavailable");
assert.match(sitemapResponse.headers.get("content-type") ?? "", /xml/);
const sitemapText = await sitemapResponse.text();
assert.match(sitemapText, /<urlset/);
assert.match(sitemapText, /https:\/\/bkedigitalsolutions\.com\/products/);
assert.doesNotMatch(sitemapText, /https:\/\/bkedigitalsolutions\.com\/(?:admin|dashboard|checkout|api|support)/);
console.log("PASS: public robots, approved sitemap and Open Graph/Twitter metadata in workerd");

// Assert the actual published routes return 200, not merely that the links exist.
for (const legalPath of ["/legal/privacy-policy", "/legal/terms-of-service"]) {
  const response = await fetch(origin + legalPath, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, "Canonical published legal route unavailable: " + legalPath);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
}

const products = await fetch(origin + "/products", { signal: AbortSignal.timeout(15000) });
assert.equal(products.status, 200);
const productsHtml = await products.text();
const imageTags = [...productsHtml.matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
assert.ok(imageTags.some(tag => tag.includes(`src="${imageUrl}"`)), "Catalog must render the validated GitHub image in an img src");

const login = await fetch(origin + "/login", { signal: AbortSignal.timeout(15000) });
assert.equal(login.status, 200);
assert.match(await login.text(), /google/i);
const retired = await fetch(origin + "/api/auth/login", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "fixture@example.invalid", password: "retired" }),
});
assert.equal(retired.status, 404, "Removed password login route must not be exposed");

const signingKeysResponse = await fetch(origin + "/api/licensing/keys", { signal: AbortSignal.timeout(15000) });
assert.equal(signingKeysResponse.status, 200, "Worker signing-key registry lookup failed");
assert.equal(signingKeysResponse.headers.get("x-bke-licensing-version") !== null, true);
const signingKeys = await signingKeysResponse.json();
assert.equal(signingKeys.keys.length, 1, "Expected exactly one active public signing key");
assert.equal(signingKeys.keys[0].algorithm, "Ed25519");
assert.match(signingKeys.keys[0].key_id, /^[a-zA-Z0-9._-]+$/);
assert.match(signingKeys.keys[0].public_key, /^-----BEGIN PUBLIC KEY-----/);
const repeatedKeysResponse = await fetch(origin + "/api/licensing/keys", { signal: AbortSignal.timeout(15000) });
assert.equal(repeatedKeysResponse.status, 200);
assert.deepEqual((await repeatedKeysResponse.json()).keys, signingKeys.keys, "Worker key registry identity changed between reads");
console.log("PASS: workerd public receiving checks and stable Ed25519 key-registry identity");
console.log("LIMIT: public key registry reads do not prove commercial lease signing or issuance");
console.log("NOT VERIFIED: real Google sign-in, native handoff, deployed Free CPU limits");

const { readFile } = await import("node:fs/promises");
const { promisify } = await import("node:util");
const { execFile } = await import("node:child_process");
const sessions = JSON.parse(await readFile(".certification-secrets/workers-sessions.json", "utf8"));
const authenticatedHome = await fetch(origin + "/", {
  headers: { cookie: "__Host-bke_session=" + sessions[0].token },
  signal: AbortSignal.timeout(15000),
});
assert.equal(authenticatedHome.status, 200, "Authenticated Sonnet homepage failed");
const authenticatedHtml = await authenticatedHome.text();
assert.match(authenticatedHtml, /<header\b[^>]*class="site-header"/,
  "Verified server session must show account navigation");
assert.match(authenticatedHtml, /My Software/,
  "Verified customer must receive My Software CTA");
console.log("PASS: anonymous Sonnet storefront and verified-session navigation in real workerd");
// Browser behavior must be proven against the running disposable application,
// not a separate generated mockup. Core is explicitly invoked by the PR plan.
if (process.env.GITHUB_ACTIONS === "true") {
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, ["scripts/workers-ui-browser-smoke.mjs"], { stdio: "inherit" });
}

// Keep concurrent principal isolation proof. Bounded retries apply solely to
// disposable workerd transport socket closures after the Chromium UI pass;
// never retry an HTTP 4xx/5xx or a missing/other principal assertion.
async function readDashboardWithSocketRetry(session) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(origin + "/dashboard", {
        headers: { cookie: "__Host-bke_session=" + session.token },
        redirect: "manual", signal: AbortSignal.timeout(15000),
      });
      return { status: response.status, html: await response.text() };
    } catch (error) {
      const code = error?.cause?.code;
      if (attempt === 3 || (code !== "UND_ERR_SOCKET" && code !== "ECONNRESET")) {
        throw error;
      }
      console.warn("WARN: disposable workerd dashboard socket closed; bounded transport retry");
      await setTimeout(attempt * 250);
    }
  }
  throw new Error("WORKER_DASHBOARD_RETRY_EXHAUSTED");
}

for (let invocation = 0; invocation < 2; invocation++) {
  await Promise.all(sessions.map(async (session, index) => {
    const { status, html } = await readDashboardWithSocketRetry(session);
    assert.equal(status, 200, "Authenticated dashboard failed");
    assert.ok(html.includes(session.name), "Own principal missing");
    assert.ok(!html.includes(sessions[1 - index].name), "Cross-account data exposure");
  }));
}
const logout = await fetch(origin + "/api/auth/logout", {
  method: "POST",
  headers: {
    origin: "https://workers-ci.example.invalid",
    cookie: "__Host-bke_session=" + sessions[1].token,
  },
  redirect: "manual",
  signal: AbortSignal.timeout(15000),
});
assert.equal(logout.status, 200, "Actual Worker session termination route failed");
assert.deepEqual(await logout.json(), { ok: true });
assert.match(logout.headers.get("set-cookie") ?? "", /__Host-bke_session=;/, "Logout did not clear the session cookie");
const loggedOut = await fetch(origin + "/dashboard", {
  headers: { cookie: "__Host-bke_session=" + sessions[1].token }, redirect: "manual",
});
assert.ok([303, 307].includes(loggedOut.status), "Worker logout left the session usable");
assert.match(loggedOut.headers.get("location") ?? "", /\/login/);
await loggedOut.text();
console.log("PASS: authenticated Worker logout terminates its database-backed session");

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
