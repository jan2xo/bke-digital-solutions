import { describe, expect, it, vi } from "vitest";
import { createAuditPort, redactAuditMetadata } from "../index";
import type { AuditSink, RedactedAuditWriteInput } from "../contracts";

describe("V2 platform audit", () => {
  it("preserves V1 recursive sensitive-key redaction semantics", () => {
    const input = {
      safe: "visible",
      password: "p",
      nested: {
        apiKey: "k",
        checkout_url: "https://secret.example",
        requestBody: { safe: "must-not-survive-because-parent-is-sensitive" },
        list: [
          { cookie: "session", keep: 1 },
          { authorization: "Bearer x", signature: "sig" },
        ],
      },
    };

    expect(redactAuditMetadata(input)).toEqual({
      safe: "visible",
      password: "[REDACTED]",
      nested: {
        apiKey: "[REDACTED]",
        checkout_url: "[REDACTED]",
        requestBody: "[REDACTED]",
        list: [
          { cookie: "[REDACTED]", keep: 1 },
          { authorization: "[REDACTED]", signature: "[REDACTED]" },
        ],
      },
    });

    expect(input.nested.apiKey).toBe("k");
  });

  it("redacts by key rather than innocent value content", () => {
    expect(
      redactAuditMetadata({
        message: "the word token may appear in a safe value",
        tokenLabel: "secret-value",
      }),
    ).toEqual({
      message: "the word token may appear in a safe value",
      tokenLabel: "[REDACTED]",
    });
  });

  it("writes only the redacted platform record and returns the sink result", async () => {
    const write = vi.fn(async (_input: RedactedAuditWriteInput) => ({ id: "audit-1" }));
    const sink: AuditSink<{ id: string }> = { write };
    const audit = createAuditPort(sink);

    await expect(
      audit.record({
        actorId: "user-1",
        accountId: "account-1",
        action: "SUPPORT_TICKET_CREATED",
        targetType: "SupportTicket",
        targetId: "ticket-1",
        metadata: {
          publicId: "BKE-SUP-2026-ABCDEF1234",
          accessToken: "must-not-leak",
        },
      }),
    ).resolves.toEqual({ id: "audit-1" });

    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith({
      actorId: "user-1",
      accountId: "account-1",
      action: "SUPPORT_TICKET_CREATED",
      targetType: "SupportTicket",
      targetId: "ticket-1",
      metadata: {
        publicId: "BKE-SUP-2026-ABCDEF1234",
        accessToken: "[REDACTED]",
      },
    });
  });

  it("normalizes omitted metadata to an empty object before persistence", async () => {
    const write = vi.fn(async (_input: RedactedAuditWriteInput) => undefined);
    const audit = createAuditPort({ write });

    await audit.record({ action: "SYSTEM_EVENT", targetType: "System" });

    expect(write).toHaveBeenCalledWith({
      actorId: undefined,
      accountId: undefined,
      action: "SYSTEM_EVENT",
      targetType: "System",
      targetId: undefined,
      metadata: {},
    });
  });
});
