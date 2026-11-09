import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("public navigation reconciliation", () => {
  it("keeps How it works on the licensing explainer without a redundant Licensing menu item", () => {
    const header = read("components/header.tsx");
    expect(header).toContain('<Link href="/licensing">How it works</Link>');
    expect(header).not.toContain('href="/licensing">Licensing</Link>');
  });

  it("keeps decorative numbering out of the approved landing", () => {
    const landing = read("app/landing-experience.tsx");
    expect(landing).not.toMatch(/<(?:b|span)>0[1-3]<\/(?:b|span)>/);
    expect(landing).not.toContain('className="lane-code"');
    expect(landing).not.toContain('className="solution-number"');
  });

  it("uses the legal business identity in the footer", () => {
    const footer = read("components/footer.tsx");
    expect(footer).toContain('BKES Information Technology Solutions');
  });
});
