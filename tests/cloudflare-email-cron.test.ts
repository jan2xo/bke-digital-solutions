import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { invokeEmailOutboxCron, type EmailOutboxCronEnvironment } from "../workers/email-cron";

function bindings(overrides: Partial<EmailOutboxCronEnvironment> = {}) {
  const fetch = vi.fn(async (_request: Request) =>
    Response.json({ succeeded: true, runId: "disposable-job" }));
  return {
    fetch,
    env: {
      enabled: "true",
      cronSecret: "disposable-cron-secret-of-sufficient-length",
      appUrl: "https://bkedigitalsolutions.com",
      selfService: { fetch },
      ...overrides,
    } satisfies EmailOutboxCronEnvironment,
  };
}

describe("Cloudflare email outbox scheduled entry", () => {
  it("does absolutely nothing when not explicitly enabled", async () => {
    const { env, fetch } = bindings({
      enabled: undefined, cronSecret: undefined, appUrl: undefined,
    });
    expect(await invokeEmailOutboxCron(env)).toBe("DISABLED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the existing protected email route only through the self-service binding", async () => {
    const { env, fetch } = bindings();
    expect(await invokeEmailOutboxCron(env)).toBe("COMPLETED");
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = fetch.mock.calls[0][0];
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://bkedigitalsolutions.com/api/cron/email-outbox");
    expect(request.headers.get("authorization")).toBe("Bearer " + env.cronSecret);
    expect(request.body).toBeNull();
  });

  it("rejects missing secret or self-reference before any dispatch", async () => {
    const noSecret = bindings({ cronSecret: "" });
    await expect(invokeEmailOutboxCron(noSecret.env))
      .rejects.toThrow("EMAIL_OUTBOX_CRON_SECRET_UNAVAILABLE");
    expect(noSecret.fetch).not.toHaveBeenCalled();

    const noService = bindings({ selfService: undefined });
    await expect(invokeEmailOutboxCron(noService.env))
      .rejects.toThrow("EMAIL_OUTBOX_CRON_SELF_SERVICE_UNAVAILABLE");
    expect(noService.fetch).not.toHaveBeenCalled();
  });

  it("rejects untrusted origin and never dispatches", async () => {
    const nonHttps = bindings({ appUrl: "http://bkedigitalsolutions.com" });
    await expect(invokeEmailOutboxCron(nonHttps.env))
      .rejects.toThrow("EMAIL_OUTBOX_CRON_APP_URL_INVALID");
    expect(nonHttps.fetch).not.toHaveBeenCalled();
  });

  it("reports authorization failures and failed jobs instead of claiming success", async () => {
    const unauthorized = bindings();
    unauthorized.fetch.mockResolvedValueOnce(Response.json({ error: "UNAUTHORIZED" }, { status: 401 }));
    await expect(invokeEmailOutboxCron(unauthorized.env))
      .rejects.toThrow("EMAIL_OUTBOX_CRON_HTTP_401");

    const failed = bindings();
    failed.fetch.mockResolvedValueOnce(Response.json({ succeeded: false, errorCode: "EMAIL_DISPATCH_FAILED" }));
    await expect(invokeEmailOutboxCron(failed.env))
      .rejects.toThrow("EMAIL_OUTBOX_CRON_JOB_UNSUCCESSFUL");

    const broken = bindings();
    broken.fetch.mockResolvedValueOnce(new Response("not json"));
    await expect(invokeEmailOutboxCron(broken.env))
      .rejects.toThrow("EMAIL_OUTBOX_CRON_INVALID_RESPONSE");
  });

  it("accepts the existing scheduler's idempotent duplicate result", async () => {
    const { env, fetch } = bindings();
    fetch.mockResolvedValueOnce(Response.json({ duplicate: true }));
    expect(await invokeEmailOutboxCron(env)).toBe("COMPLETED");
  });

  it("wires the Worker scheduled handler without enabling a Cron Trigger in code-only config", () => {
    const worker = readFileSync("workers/entry.ts", "utf8");
    const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
    expect(worker).toContain("async scheduled(");
    expect(worker).toContain("invokeEmailOutboxCron(");
    expect(worker).toContain("EMAIL_OUTBOX_CRON_ENABLED");
    expect(config.triggers?.crons).toBeUndefined();
  });
});
