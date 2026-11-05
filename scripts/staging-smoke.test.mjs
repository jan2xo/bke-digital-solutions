import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STAGING_ORIGIN, verifyPublicStaging } from "./staging-smoke.mjs";

function healthyFetch(overrides = {}) {
  const calls = [];
  const responses = {
    "/": new Response("<!doctype html><html><body>Home</body></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
    "/login": new Response("<!doctype html><html><button>Sign in with Google</button></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
    "/api/health/ready": new Response(JSON.stringify({
      status: "ready",
      dependencies: { postgresql: "up", valkey: "up", providers: "up" },
    }), { headers: { "content-type": "application/json" } }),
    ...overrides,
  };
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    return responses[url.pathname];
  };
  return { calls, fetchImpl };
}

describe("public Staging smoke", () => {
  it("checks only the fixed origin without cookies or authorization and accepts healthy core dependencies without object storage", async () => {
    const { calls, fetchImpl } = healthyFetch();
    await verifyPublicStaging(fetchImpl);

    assert.deepEqual(calls.map(({ url }) => url.href), [
      `${STAGING_ORIGIN}/`,
      `${STAGING_ORIGIN}/login`,
      `${STAGING_ORIGIN}/api/health/ready`,
    ]);
    for (const { init } of calls) {
      assert.equal(init.method, "GET");
      assert.equal(init.credentials, "omit");
      assert.equal(init.redirect, "manual");
      assert.ok(init.signal instanceof AbortSignal);
      assert.equal(new Headers(init.headers).has("authorization"), false);
      assert.equal(new Headers(init.headers).has("cookie"), false);
    }
  });

  it("fails closed on a redirect without following it", async () => {
    const { calls, fetchImpl } = healthyFetch({
      "/": new Response(null, { status: 302, headers: { location: "/login" } }),
    });
    await assert.rejects(verifyPublicStaging(fetchImpl), /GET \/ expected HTTP 200, received 302/);
    assert.equal(calls.length, 1);
  });

  it("requires the Google sign-in affordance on the login page", async () => {
    const { fetchImpl } = healthyFetch({
      "/login": new Response("<html><body>Unavailable</body></html>", {
        headers: { "content-type": "text/html" },
      }),
    });
    await assert.rejects(verifyPublicStaging(fetchImpl), /lacks the Google sign-in affordance/);
  });

  it("requires ready PostgreSQL, Valkey and provider checks without primary object storage", async () => {
    const { fetchImpl } = healthyFetch({
      "/api/health/ready": new Response(JSON.stringify({
        status: "ready",
        dependencies: { postgresql: "up", valkey: "up", providers: "up", objectStorage: "up" },
      }), { headers: { "content-type": "application/json" } }),
    });
    await assert.rejects(verifyPublicStaging(fetchImpl), /without primary object storage/);
  });

  it("fails readiness when any required dependency is down or missing", async () => {
    for (const dependencies of [
      { postgresql: "up", valkey: "down", providers: "up" },
      { postgresql: "up", providers: "up" },
    ]) {
      const { fetchImpl } = healthyFetch({
        "/api/health/ready": new Response(JSON.stringify({
          status: "ready",
          dependencies,
        }), { headers: { "content-type": "application/json" } }),
      });
      await assert.rejects(verifyPublicStaging(fetchImpl), /not ready/);
    }
  });

  it("rejects a non-JSON readiness response", async () => {
    const { fetchImpl } = healthyFetch({
      "/api/health/ready": new Response("<html>not readiness</html>", {
        headers: { "content-type": "text/html" },
      }),
    });
    await assert.rejects(verifyPublicStaging(fetchImpl), /did not return JSON/);
  });

  it("bounds response bodies", async () => {
    const { fetchImpl } = healthyFetch({
      "/": new Response("x".repeat(1_048_577), {
        headers: { "content-type": "text/html" },
      }),
    });
    await assert.rejects(verifyPublicStaging(fetchImpl), /response exceeded its size limit/);
  });

  it("reports network failures without printing response bodies or raw exception text", async () => {
    const failingFetch = async () => { throw new TypeError("sensitive detail must not be surfaced"); };
    await assert.rejects(verifyPublicStaging(failingFetch), (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Public Staging smoke GET / failed (NETWORK_ERROR)");
      assert.doesNotMatch(error.message, /sensitive detail/);
      return true;
    });
  });
});
