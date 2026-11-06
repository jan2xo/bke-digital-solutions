import { randomUUID } from "node:crypto";
import { Client, Pool } from "pg";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostgresEmailOutboxStore } from "@/apps/web/email";
import { dispatchEmailOutbox } from "@/platform/email/outbox-dispatch";
import { EmailDeliveryError } from "@/platform/email/failures";
import type { EmailProvider } from "@/platform/email/contracts";

const connectionString = process.env.DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
let schema: string;
let pool: Pool | undefined;
function activePool(): Pool { if (!pool) throw new Error("Fixture pool missing"); return pool; }
function quote(value: string) { return '"' + value.replaceAll('"', '""') + '"'; }

suite("disposable PostgreSQL email delivery uncertainty", () => {
  beforeAll(() => {
    const url = new URL(connectionString!);
    if (process.env.GITHUB_ACTIONS !== "true" || process.env.NODE_ENV !== "test" ||
        url.username !== "bke" || url.port !== "5432" || !["postgres:", "postgresql:"].includes(url.protocol) ||
        !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname) ||
        url.pathname !== "/bke_test") {
      throw new Error("Email delivery tests require disposable local bke_test PostgreSQL");
    }
  });
  beforeEach(async () => {
    schema = "_bke_email_test_" + randomUUID().replaceAll("-", "");
    const control = new Client({ connectionString });
    await control.connect();
    try {
      await control.query(`CREATE SCHEMA ${quote(schema)}`);
      await control.query(`CREATE TABLE ${quote(schema)}."EmailOutbox" (LIKE public."EmailOutbox" INCLUDING ALL)`);
    } finally { await control.end(); }
    pool = new Pool({ connectionString, options: "-c search_path=" + schema + ",pg_catalog", max: 4 });
  });
  afterEach(async () => {
    const closing = pool; pool = undefined;
    if (closing) await closing.end();
    if (!schema) return;
    if (!/^_bke_email_test_[a-f0-9]{32}$/.test(schema)) throw new Error("Invalid fixture schema");
    const control = new Client({ connectionString });
    await control.connect();
    try { await control.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`); }
    finally { await control.end(); }
  });
  function store() { return createPostgresEmailOutboxStore(() => activePool()); }
  async function insert() {
    const id = randomUUID();
    await activePool().query(
      `INSERT INTO "EmailOutbox" ("id", "type", "recipient", "subject", "payload", "status", "attempts", "createdAt")
       VALUES ($1, 'INVOICE_ISSUED', 'fixture@example.invalid', 'Invoice fixture', '{"invoiceNumber":"TEST"}', 'PENDING', 0, NOW())`,
      [id],
    );
    return id;
  }
  async function row(id: string) {
    return (await activePool().query('SELECT * FROM "EmailOutbox" WHERE "id"=$1', [id])).rows[0];
  }
  it("stops a timed-out or unknown delivery and never dispatches it again", async () => {
    const id = await insert();
    const send = vi.fn(async () => {
      throw new EmailDeliveryError({ provider: "cloudflare", category: "DELIVERY_UNCONFIRMED" });
    });
    const first = await dispatchEmailOutbox({ store: store(), provider: { send } });
    expect(first).toMatchObject({ sent: 0, failed: 1, terminal: 1 });
    expect(await row(id)).toMatchObject({
      status: "PERMANENTLY_FAILED", lastError: "DELIVERY_UNCONFIRMED", attempts: 1, claimedBy: null,
    });
    await dispatchEmailOutbox({ store: store(), provider: { send } });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("treats a plain unexpected send error as unconfirmed without leaking its text", async () => {
    const id = await insert();
    await dispatchEmailOutbox({ store: store(), provider: {
      async send() { throw new Error("private-token and private-recipient@example.invalid"); },
    } });
    expect(await row(id)).toMatchObject({ status: "PERMANENTLY_FAILED", lastError: "DELIVERY_UNCONFIRMED" });
  });
  it("does not retry after provider acceptance followed by acknowledgement persistence failure", async () => {
    const id = await insert();
    const real = store();
    const send = vi.fn(async () => undefined);
    await dispatchEmailOutbox({
      store: { ...real, async markSent() { throw new Error("database acknowledgement unavailable"); } },
      provider: { send },
    });
    expect(await row(id)).toMatchObject({
      status: "PERMANENTLY_FAILED", lastError: "DELIVERY_UNCONFIRMED", attempts: 1,
    });
    await dispatchEmailOutbox({ store: real, provider: { send } });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("holds expired processing claims for review instead of automatically retrying a possible send", async () => {
    const id = await insert();
    const real = store();
    const old = new Date(Date.now() - 10_000);
    expect(await real.claim({
      id, expectedStatus: "PENDING", expectedAttempts: 0, workerId: "crashed",
      claimedAt: old, claimExpiresAt: new Date(old.getTime() + 1_000),
    })).toBe(true);
    const send = vi.fn(async () => undefined);
    const result = await dispatchEmailOutbox({ store: real, provider: { send } });
    expect(result.recovered).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(await row(id)).toMatchObject({
      status: "PERMANENTLY_FAILED", lastError: "DELIVERY_UNCONFIRMED", claimedBy: null, attempts: 1,
    });
  });
  it("retains bounded retry for definite rejection only", async () => {
    const id = await insert();
    const provider: EmailProvider = { async send() {
      throw new EmailDeliveryError({ provider: "resend", category: "RATE_LIMITED" },
        { acceptance: "REJECTED", retry: "RETRY", fallbackEligible: false });
    } };
    await dispatchEmailOutbox({ store: store(), provider });
    expect(await row(id)).toMatchObject({ status: "FAILED", lastError: "RATE_LIMITED", attempts: 1 });
    await dispatchEmailOutbox({ store: store(), provider });
    expect(await row(id)).toMatchObject({ status: "FAILED", attempts: 2 });
  });
  it("keeps sender/recipient policy rejection terminal", async () => {
    const id = await insert();
    await dispatchEmailOutbox({ store: store(), provider: { async send() {
      throw new EmailDeliveryError({ provider: "cloudflare", category: "INVALID_RECIPIENT" },
        { acceptance: "REJECTED", retry: "STOP", fallbackEligible: false });
    } } });
    expect(await row(id)).toMatchObject({ status: "PERMANENTLY_FAILED", lastError: "INVALID_RECIPIENT" });
  });
  it("permits only one concurrent worker to send a claimed email", async () => {
    const id = await insert();
    const send = vi.fn(async () => undefined);
    await Promise.all([
      dispatchEmailOutbox({ store: store(), provider: { send } }, { workerId: "first" }),
      dispatchEmailOutbox({ store: store(), provider: { send } }, { workerId: "second" }),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await row(id)).toMatchObject({ status: "SENT", attempts: 1, lastError: null });
  });
});
