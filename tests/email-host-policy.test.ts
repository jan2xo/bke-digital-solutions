import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configuration: vi.fn() }));
vi.mock("@/apps/web/providers/capability", () => ({
  resolveResendConfiguration: mocks.configuration,
}));
import { emailProvider } from "@/apps/web/email";

const message = { to: "fixture@example.invalid", subject: "Invoice fixture", text: "Fixture" };
describe("business email host policy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEPLOYMENT_ENV", "production");
    vi.stubEnv("BKE_RUNTIME", "workers");
    vi.stubEnv("EMAIL_PROVIDER", "cloudflare");
    vi.stubEnv("EMAIL_FROM", "BKE <billing@bke.example>");
    vi.stubEnv("RESEND_SANDBOX_TO", "");
    vi.stubEnv("BKE_DISABLE_EXTERNAL_EMAIL", "");
  });
  afterEach(() => vi.unstubAllEnvs());
  it("rejects direct Resend selection in Worker production before accessing credentials", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    await expect(emailProvider.send(message)).rejects.toThrow("Cloudflare primary");
    expect(mocks.configuration).not.toHaveBeenCalled();
  });
  it("does not promote a missing Node Cloudflare binding to Resend primary", async () => {
    vi.stubEnv("BKE_RUNTIME", "");
    await expect(emailProvider.send(message)).rejects.toMatchObject({
      safe: { provider: "cloudflare", category: "PROVIDER_UNAVAILABLE" },
      policy: { acceptance: "REJECTED", preCall: true, fallbackEligible: false },
    });
    expect(mocks.configuration).not.toHaveBeenCalled();
  });
  it("keeps an explicit Node cold-target Resend mode without pretending to have a binding", async () => {
    vi.stubEnv("BKE_RUNTIME", "");
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    mocks.configuration.mockRejectedValue(new Error("configuration not installed"));
    await expect(emailProvider.send(message)).rejects.toMatchObject({
      safe: { provider: "resend" },
      policy: { acceptance: "REJECTED", preCall: true },
    });
    expect(mocks.configuration).toHaveBeenCalledOnce();
  });
  it("does not silently acknowledge disabled production delivery", async () => {
    vi.stubEnv("BKE_DISABLE_EXTERNAL_EMAIL", "true");
    await expect(emailProvider.send(message)).rejects.toThrow("enabled external transport");
    expect(mocks.configuration).not.toHaveBeenCalled();
  });
  it("keeps queue-only legacy consumers independent of transport configuration", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "invalid");
    vi.stubEnv("EMAIL_FROM", "");
    const legacy = await import("@/lib/email");
    const create = vi.fn(async () => undefined);
    const transaction = { emailOutbox: { create } };
    await legacy.queueCommerceEmail(transaction as never, {
      type: "INVOICE_ISSUED", recipient: message.to, subject: message.subject, payload: {},
    });
    expect(create).toHaveBeenCalledOnce();
    expect(mocks.configuration).not.toHaveBeenCalled();
  });
});
