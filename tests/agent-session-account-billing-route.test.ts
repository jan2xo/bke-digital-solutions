import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateNativeAgentRequest: vi.fn(),
  getAgentAccountBillingHistory: vi.fn(),
  rateLimit: vi.fn(),
  getRuntimeEnvironment: vi.fn(),
}));

vi.mock("@/apps/web/agent-sessions/native-mfa", () => ({
  authenticateNativeAgentRequest:
    mocks.authenticateNativeAgentRequest,
}));

vi.mock("@/apps/web/accounts/agent-account-billing-history", () => ({
  getAgentAccountBillingHistory:
    mocks.getAgentAccountBillingHistory,
}));

vi.mock("@/apps/web/http/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
}));

vi.mock("@/platform/host/env", () => ({
  getRuntimeEnvironment: mocks.getRuntimeEnvironment,
}));

function request(headers: Record<string, string> = {}) {
  return new Request(
    "https://digital-solutions.example.test/api/agent-sessions/account/billing",
    {
      method: "GET",
      headers: {
        "x-bke-account-session-version":
          "bke.account-session.v1",
        ...headers,
      },
    },
  );
}

describe("native Agent account billing history route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getRuntimeEnvironment.mockReturnValue({
      AGENT_ACCOUNT_SESSION_ENABLED: true,
    });
    mocks.authenticateNativeAgentRequest.mockResolvedValue({
      status: "authenticated",
      userId: "billing-user-cert",
      accountId: "selected-account-cert",
      sessionId: "session-cert",
      deviceId: "device-cert",
    });
    mocks.rateLimit.mockResolvedValue({ allowed: true });
    mocks.getAgentAccountBillingHistory.mockResolvedValue({
      status: "ready",
      account: {
        type: "ORGANIZATION",
        displayName: "Certification Organization",
        lifecycleState: "ACTIVE",
        role: "BILLING",
      },
      permissions: {
        viewInvoices: true,
        viewPayments: true,
      },
      invoices: [
        {
          number: "INV-CERT-001",
          status: "FINAL",
          orderNumber: "ORD-CERT-001",
          currency: "PHP",
          subtotalMinor: 30000000,
          taxMinor: 0,
          totalMinor: 30000000,
          issuedAt: new Date("2026-10-01T01:05:00.000Z"),
          createdAt: new Date("2026-10-01T01:04:00.000Z"),
          lines: [
            {
              description: "Render Dock · Pro · Annual",
              quantity: 1,
              unitAmountMinor: 30000000,
              totalMinor: 30000000,
            },
          ],
        },
      ],
      payments: [
        {
          orderNumber: "ORD-CERT-001",
          status: "PAID",
          amountMinor: 30000000,
          currency: "PHP",
          paidAt: new Date("2026-10-01T01:00:00.000Z"),
          createdAt: new Date("2026-10-01T00:59:00.000Z"),
        },
      ],
    });
  });

  it("rejects browser-origin access before native Agent authentication", async () => {
    const { GET } = await import(
      "../app/api/agent-sessions/account/billing/route"
    );

    const response = await GET(request({
      origin: "https://browser.example.test",
    }));

    expect(response.status).toBe(403);
    expect(
      mocks.authenticateNativeAgentRequest,
    ).not.toHaveBeenCalled();
  });

  it("binds billing history to the authenticated selected account", async () => {
    const { GET } = await import(
      "../app/api/agent-sessions/account/billing/route"
    );

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(
      response.headers.get("cache-control"),
    ).toBe("no-store");
    expect(
      response.headers.get("x-bke-account-session-version"),
    ).toBe("bke.account-session.v1");
    expect(
      mocks.getAgentAccountBillingHistory,
    ).toHaveBeenCalledWith({
      principalId: "billing-user-cert",
      accountId: "selected-account-cert",
    });

    const payload = await response.json();
    expect(payload).toEqual({
      status: "ready",
      account: {
        type: "ORGANIZATION",
        display_name: "Certification Organization",
        lifecycle_state: "ACTIVE",
        role: "BILLING",
      },
      permissions: {
        view_invoices: true,
        view_payments: true,
      },
      invoices: [
        {
          number: "INV-CERT-001",
          status: "FINAL",
          order_number: "ORD-CERT-001",
          currency: "PHP",
          subtotal_minor: 30000000,
          tax_minor: 0,
          total_minor: 30000000,
          issued_at: "2026-10-01T01:05:00.000Z",
          created_at: "2026-10-01T01:04:00.000Z",
          lines: [
            {
              description: "Render Dock · Pro · Annual",
              quantity: 1,
              unit_amount_minor: 30000000,
              total_minor: 30000000,
            },
          ],
        },
      ],
      payments: [
        {
          order_number: "ORD-CERT-001",
          status: "PAID",
          amount_minor: 30000000,
          currency: "PHP",
          paid_at: "2026-10-01T01:00:00.000Z",
          created_at: "2026-10-01T00:59:00.000Z",
        },
      ],
    });

    const wire = JSON.stringify(payload);
    for (const forbidden of [
      "invoice_id",
      "payment_id",
      "order_id",
      "provider",
      "external_id",
      "checkout_url",
      "customer_snapshot",
      "billing_snapshot",
    ]) {
      expect(wire).not.toContain(forbidden);
    }
  });

  it("preserves auth, selected-account denial, rate-limit, and runtime gates", async () => {
    const { GET } = await import(
      "../app/api/agent-sessions/account/billing/route"
    );

    mocks.authenticateNativeAgentRequest.mockResolvedValueOnce({
      status: "invalid",
    });
    const unauthenticated = await GET(request());
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({
      error: "INVALID_TOKEN",
    });

    mocks.getAgentAccountBillingHistory.mockResolvedValueOnce({
      status: "forbidden",
    });
    const forbidden = await GET(request());
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error: "ACCOUNT_FORBIDDEN",
    });

    mocks.rateLimit.mockResolvedValueOnce({ allowed: false });
    const limited = await GET(request());
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: "RATE_LIMITED",
    });

    mocks.getRuntimeEnvironment.mockReturnValueOnce({
      AGENT_ACCOUNT_SESSION_ENABLED: false,
    });
    const disabled = await GET(request());
    expect(disabled.status).toBe(404);
    expect(await disabled.json()).toEqual({
      error: "NOT_FOUND",
    });
  });
});
