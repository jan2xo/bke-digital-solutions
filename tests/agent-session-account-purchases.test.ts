import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateNativeAgentRequest: vi.fn(),
  getAgentAccountPurchasesOverview: vi.fn(),
  rateLimit: vi.fn(),
  getRuntimeEnvironment: vi.fn(),
}));

vi.mock("@/apps/web/agent-sessions/native-mfa", () => ({
  authenticateNativeAgentRequest:
    mocks.authenticateNativeAgentRequest,
}));
vi.mock(
  "@/apps/web/accounts/agent-account-purchases-overview",
  () => ({
    getAgentAccountPurchasesOverview:
      mocks.getAgentAccountPurchasesOverview,
  }),
);
vi.mock("@/apps/web/http/rate-limit", () => ({
  rateLimit: mocks.rateLimit,
}));
vi.mock("@/platform/host/env", () => ({
  getRuntimeEnvironment: mocks.getRuntimeEnvironment,
}));

describe("Agent-session account purchases overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRuntimeEnvironment.mockReturnValue({
      AGENT_ACCOUNT_SESSION_ENABLED: true,
    });
    mocks.authenticateNativeAgentRequest.mockResolvedValue({
      status: "authenticated",
      userId: "principal-cert",
      accountId: "selected-account-cert",
      sessionId: "agent-session-cert",
      deviceId: "device-cert",
    });
    mocks.rateLimit.mockResolvedValue({ allowed: true });
    mocks.getAgentAccountPurchasesOverview.mockResolvedValue({
      status: "ready",
      account: {
        type: "ORGANIZATION",
        displayName: "Certification Organization",
        lifecycleState: "ACTIVE",
        role: "OWNER",
      },
      permissions: {
        viewOrders: true,
        viewSubscriptions: true,
        viewAllLicenses: true,
      },
      licenses: [
        {
          productName: "Render Dock",
          editionName: "Pro",
          planType: "ANNUAL",
          status: "ACTIVE",
          keyLastFour: "ABCD",
          expiresAt: new Date("2027-09-30T00:00:00.000Z"),
          maxDevices: 4,
          activeDevices: 1,
        },
      ],
      subscriptions: [
        {
          productName: "Render Dock",
          editionName: "Pro",
          planType: "ANNUAL",
          status: "ACTIVE",
          seats: 2,
          currentPeriodEnd:
            new Date("2027-09-30T00:00:00.000Z"),
        },
      ],
      orders: [
        {
          number: "ORD-CERT-001",
          status: "PAID",
          totalMinor: 30000000,
          currency: "PHP",
          createdAt:
            new Date("2026-09-30T00:00:00.000Z"),
          invoiceAvailable: true,
          items: [
            {
              productName: "Render Dock",
              editionName: "Pro",
              planName: "Annual",
            },
          ],
        },
      ],
    });
  });

  function request(
    headers: Record<string, string> = {},
  ) {
    return new Request(
      "https://digital-solutions.example.test/api/agent-sessions/account/purchases",
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

  it("rejects browser-origin reads before Agent authentication", async () => {
    const { GET } = await import(
      "../app/api/agent-sessions/account/purchases/route"
    );
    const response = await GET(request({
      origin: "https://browser.example.test",
    }));

    expect(response.status).toBe(403);
    expect(
      mocks.authenticateNativeAgentRequest,
    ).not.toHaveBeenCalled();
    expect(
      response.headers.get("x-bke-account-session-version"),
    ).toBe("bke.account-session.v1");
  });

  it("binds the read to authenticated principal and selected account", async () => {
    const { GET } = await import(
      "../app/api/agent-sessions/account/purchases/route"
    );
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(
      mocks.getAgentAccountPurchasesOverview,
    ).toHaveBeenCalledWith({
      principalId: "principal-cert",
      accountId: "selected-account-cert",
    });

    const payload = await response.json();
    expect(payload).toEqual({
      status: "ready",
      account: {
        type: "ORGANIZATION",
        display_name: "Certification Organization",
        lifecycle_state: "ACTIVE",
        role: "OWNER",
      },
      permissions: {
        view_orders: true,
        view_subscriptions: true,
        view_all_licenses: true,
      },
      licenses: [
        {
          product_name: "Render Dock",
          edition_name: "Pro",
          plan_type: "ANNUAL",
          status: "ACTIVE",
          key_last_four: "ABCD",
          expires_at: "2027-09-30T00:00:00.000Z",
          max_devices: 4,
          active_devices: 1,
        },
      ],
      subscriptions: [
        {
          product_name: "Render Dock",
          edition_name: "Pro",
          plan_type: "ANNUAL",
          status: "ACTIVE",
          seats: 2,
          current_period_end:
            "2027-09-30T00:00:00.000Z",
        },
      ],
      orders: [
        {
          number: "ORD-CERT-001",
          status: "PAID",
          total_minor: 30000000,
          currency: "PHP",
          created_at: "2026-09-30T00:00:00.000Z",
          invoice_available: true,
          items: [
            {
              product_name: "Render Dock",
              edition_name: "Pro",
              plan_name: "Annual",
            },
          ],
        },
      ],
    });

    const wire = JSON.stringify(payload).toLowerCase();
    for (const forbidden of [
      "selected-account-cert",
      "principal-cert",
      "agent-session-cert",
      "device-cert",
      "access_token",
      "refresh_token",
      "checkout_url",
      "payment",
      "provider",
      "license_id",
      "order_id",
      "subscription_id",
      "invoice_id",
      "device_id",
      "license_key",
    ]) {
      expect(wire).not.toContain(forbidden);
    }
  });

  it("preserves authorization denial and rate limiting", async () => {
    const { GET } = await import(
      "../app/api/agent-sessions/account/purchases/route"
    );

    mocks.getAgentAccountPurchasesOverview.mockResolvedValueOnce({
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
  });

  it("fails closed when authoritative account purchases state is unavailable", async () => {
    mocks.getAgentAccountPurchasesOverview.mockResolvedValueOnce({
      status: "failed",
    });
    const { GET } = await import(
      "../app/api/agent-sessions/account/purchases/route"
    );
    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "ACCOUNT_PURCHASES_UNAVAILABLE",
    });
  });
});
