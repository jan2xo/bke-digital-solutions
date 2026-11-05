import test from "node:test";
import assert from "node:assert/strict";
import { upstashPingEndpoint, verifyStagingRedis } from "./certify-staging-redis.mjs";

const input = {
  UPSTASH_REDIS_REST_URL: "https://bke-staging.upstash.io/",
  UPSTASH_REDIS_REST_TOKEN: "protected-secret",
  CLOUDFLARE_API_TOKEN: "must-not-be-forwarded",
};
const response = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers });

test("read-only PING uses a fixed Upstash endpoint, correct REST bearer and no unrelated credentials", async () => {
  let seen;
  const result = await verifyStagingRedis(input, async (url, options) => {
    seen = { url, options };
    return response(JSON.stringify({ result: "PONG" }));
  });
  assert.deepEqual(result, { code: "PONG", httpStatus: 200, pong: true });
  assert.equal(seen.url.href, "https://bke-staging.upstash.io/ping");
  assert.equal(seen.options.method, "GET");
  assert.equal(seen.options.headers.authorization, "Bearer protected-secret");
  assert.equal(seen.options.headers.accept, "application/json");
  assert.equal(seen.options.credentials, "omit");
  assert.equal(seen.options.redirect, "manual");
  assert.equal(seen.options.cache, "no-store");
  assert.ok(!JSON.stringify({ url: String(seen.url), headers: seen.options.headers }).includes(input.CLOUDFLARE_API_TOKEN));
});

test("401 is a genuine fail-closed AUTH_UNAUTHORIZED, not a pass or bypass", async () => {
  const actual = await verifyStagingRedis(input, async () => response('{"error":"wrong token"}', 401));
  assert.deepEqual(actual, { code: "AUTH_UNAUTHORIZED", httpStatus: 401, pong: false });
});

test("403, redirects, and other HTTP failures are distinct sanitized categories", async () => {
  for (const [status, code] of [[403, "AUTH_FORBIDDEN"], [302, "REDIRECT_BLOCKED"], [500, "HTTP_ERROR"]]) {
    assert.equal((await verifyStagingRedis(input, async () => response("not pong", status))).code, code);
  }
});

test("reject HTTP, userinfo, custom ports, subpaths, queries, fragments and false domains", () => {
  const invalid = [
    "http://bke-staging.upstash.io",
    "https://upstash.io",
    "https://bke-staging.evilupstash.io",
    "https://user@bke-staging.upstash.io",
    "https://bke-staging.upstash.io:444",
    "https://bke-staging.upstash.io/other",
    "https://bke-staging.upstash.io/?token=value",
    "https://bke-staging.upstash.io/#fragment",
    "https://bke-staging.upstash.io?",
  ];
  for (const url of invalid) assert.throws(() => upstashPingEndpoint(url), /INVALID_URL/);
});

test("missing or unsafe configuration does not make a request", async () => {
  let calls = 0;
  const spy = async () => { calls++; return response('{"result":"PONG"}'); };
  assert.equal((await verifyStagingRedis({}, spy)).code, "CONFIG_MISSING");
  assert.equal((await verifyStagingRedis({ ...input, UPSTASH_REDIS_REST_URL: "https://other.test" }, spy)).code, "INVALID_URL");
  assert.equal(calls, 0);
});

test("bounds actual response bytes and rejects malformed/PONG-mismatched replies", async () => {
  assert.equal((await verifyStagingRedis(input, async () => response("x".repeat(4097)))).code, "BODY_TOO_LARGE");
  assert.equal((await verifyStagingRedis(input, async () => response("no-json"))).code, "INVALID_RESPONSE");
  assert.equal((await verifyStagingRedis(input, async () => response('{"result":"NOPE"}'))).code, "PONG_MISMATCH");
});

test("transport errors are sanitized and never expose sensitive error messages", async () => {
  const outcome = await verifyStagingRedis(input, async () => {
    throw new Error("protected-secret https://bke-staging.upstash.io");
  });
  assert.deepEqual(outcome, { code: "NETWORK_ERROR", httpStatus: null, pong: false });
  assert.equal(JSON.stringify(outcome).includes("protected-secret"), false);
});

test("TimeoutError fails without a retry or endpoint disclosure", async () => {
  let calls = 0;
  const result = await verifyStagingRedis(input, async () => {
    calls++;
    const e = new Error("protected-secret");
    e.name = "TimeoutError";
    throw e;
  });
  assert.equal(result.code, "TIMEOUT");
  assert.equal(calls, 1);
});

test("the comment target cannot be included in full source certification or executed on other PRs", async () => {
  const { readFile } = await import("node:fs/promises");
  const url = new URL("../.github/workflows/certify.yml", import.meta.url);
  const workflow = await readFile(url, "utf8");
  assert.match(workflow, /const standaloneTargets = \["redis"\]/);
  assert.match(workflow, /format\(\'\{0\}-staging-redis\', github.event.issue.number\)/);
  assert.match(workflow, /targets = allowedTargets;/);
  assert.match(workflow, /tokens.includes\("redis"\) && tokens.length !== 1/);
  assert.match(workflow, /issue.number !== 266/);
  assert.match(workflow, /context.payload.comment\?\.user\?\.login !== context.repo.owner/);
  assert.match(workflow, /context.eventName !== "issue_comment" \|\| targets.length !== 1/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/v2-staging-redis-intent\.yml/);
  const probe = await readFile(new URL("../.github/workflows/v2-staging-redis-intent.yml", import.meta.url), "utf8");
  assert.match(probe, /name: Staging/);
  assert.match(probe, /id-token: write/);
  assert.match(probe, /ref: \$\{\{ github.sha \}\}/);
  assert.match(probe, /run: node scripts\/certify-staging-redis\.mjs/);
  assert.doesNotMatch(probe, /db:deploy|wrangler deploy|initialize-staging-legal/);
});
