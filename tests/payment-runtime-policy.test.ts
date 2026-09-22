import { describe, expect, it } from "vitest";
import { assertMockPaymentsAllowed } from "@/apps/web/payments/runtime-policy";

describe("mock payment runtime policy", () => {
  it("allows mock payments for disposable test deployments even in a production Next runtime", () => {
    expect(() => assertMockPaymentsAllowed({
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "test",
    })).not.toThrow();
  });

  it("forbids mock payments for the production deployment", () => {
    expect(() => assertMockPaymentsAllowed({
      NODE_ENV: "production",
      DEPLOYMENT_ENV: "production",
    })).toThrow("V2_MOCK_PAYMENTS_FORBIDDEN_IN_PRODUCTION");
  });
});
