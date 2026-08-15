import "dotenv/config";
import { describe, expect, it } from "vitest";
import { applyLegalVariables, legalContentHash, renderLegalMarkdown } from "@/lib/legal/render";
import { checkoutLegalTypes } from "@/lib/legal/service";
import { normalizePrivacyRequestType, publicPrivacyRequestSnapshot } from "@/lib/privacy/requests";

const variables = {
  company_name: "BKE Digital Solutions",
  support_email: "support@jl-bke.com",
  website: "https://jl-bke.com",
  business_address: "Test address",
};

describe("legal document rendering", () => {
  it("renders supported Markdown and approved variables", () => {
    const html = renderLegalMarkdown("# {{company_name}}\n\nContact **{{support_email}}**.", variables);
    expect(html).toContain("<h1>BKE Digital Solutions</h1>");
    expect(html).toContain("<strong>support@jl-bke.com</strong>");
    expect(applyLegalVariables("{{website}} {{unknown}}", variables)).toBe("https://jl-bke.com {{unknown}}");
  });

  it("escapes HTML and neutralizes unsafe links", () => {
    const html = renderLegalMarkdown('<script>alert("x")</script> [bad](javascript:alert(1)) [ok](https://example.com)', variables);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="#"');
    expect(html).toContain('href="https://example.com/"');
  });

  it("produces stable hashes of the exact rendered acceptance content", () => {
    const html = renderLegalMarkdown("# Terms", variables);
    expect(legalContentHash(html)).toMatch(/^[a-f0-9]{64}$/);
    expect(legalContentHash(html)).toBe(legalContentHash(html));
    expect(legalContentHash(html)).not.toBe(legalContentHash("# Terms"));
  });
});

describe("legal checkout requirements", () => {
  it("requires EULA and refund terms for perpetual purchases", () => {
    expect(checkoutLegalTypes("PERPETUAL")).toEqual(["SOFTWARE_LICENSE_AGREEMENT", "REFUND_POLICY"]);
  });

  it("also requires subscription terms for recurring plans", () => {
    expect(checkoutLegalTypes("MONTHLY")).toContain("SUBSCRIPTION_TERMS");
    expect(checkoutLegalTypes("ANNUAL")).toHaveLength(3);
  });
});

describe("privacy request workflow helpers", () => {
  it("accepts only repository-controlled privacy request types", () => {
    expect(normalizePrivacyRequestType("ACCESS")).toBe("ACCESS");
    expect(() => normalizePrivacyRequestType("APPROVED_BY_DPO")).toThrow("INVALID_PRIVACY_REQUEST_TYPE");
  });

  it("captures bounded request metadata for audit without deciding legal merits", () => {
    const request = new Request("https://example.test/api/privacy/requests", { headers: { "user-agent": "a".repeat(600), "x-forwarded-for": "203.0.113.10" } });
    const snapshot = publicPrivacyRequestSnapshot(request);
    expect(snapshot.ipAddress).toBe("203.0.113.10");
    expect(snapshot.userAgent).toHaveLength(500);
  });
});
