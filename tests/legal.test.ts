import "dotenv/config";
import { describe, expect, it } from "vitest";
import { applyLegalVariables, legalContentHash, renderLegalMarkdown } from "@/lib/legal/render";
import { checkoutLegalTypes } from "@/lib/legal/service";

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
    const html = renderLegalMarkdown('<script>alert("x")</script> [bad](javascript:alert(1))', variables);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('href="javascript:');
  });

  it("produces stable hashes of the exact rendered acceptance content", () => {
    const html = renderLegalMarkdown("# Terms", variables);
    expect(legalContentHash(html)).toMatch(/^[a-f0-9]{64}$/);
    expect(legalContentHash(html)).toBe(legalContentHash(html));
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
