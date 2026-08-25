import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("public navigation reconciliation", () => {
  it("keeps How it works on the licensing explainer without a redundant Licensing menu item", () => {
    const header = read("components/header.tsx");
    expect(header).toContain('<Link href="/licensing">How it works</Link>');
    expect(header).not.toContain('href="/licensing">Licensing</Link>');
  });

  it("keeps numbering only on the marketplace process sequence", () => {
    const landing = read("app/landing-experience.tsx");
    expect(landing).toContain('<span><b>01</b> Discover</span><span><b>02</b> License</span><span><b>03</b> Deliver</span>');
    expect(landing).not.toContain('className="lane-code"');
    expect(landing).not.toContain('className="solution-number"');
  });

  it("uses the legal business identity in the footer", () => {
    const footer = read("components/footer.tsx");
    expect(footer).toContain('BKES Information Technology Solutions');
  });
});
