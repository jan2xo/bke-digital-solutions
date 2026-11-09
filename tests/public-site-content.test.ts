import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("public site content integration", () => {
  it("uses authoritative content for public homepage and shell copy", async () => {
    const [page, header, footer, layout, landing] = await Promise.all([
      read("app/page.tsx"),
      read("components/header.tsx"),
      read("components/footer.tsx"),
      read("app/layout.tsx"),
      read("app/landing-experience.tsx"),
    ]);

    expect(page).toContain('import { getSiteContent } from "@/apps/web/site-content"');
    expect(page).toContain("content.siteName");
    expect(page).toContain("content.heroDescription");
    expect(page).not.toMatch(/content\.hero(?:Headline|Primary|Secondary)/);
    expect(landing).toContain('href="/login"><GoogleMark /> Continue with Google');
    expect(landing).toContain('href="/products">Explore</Link>');
    expect(header).toContain('import { getSiteContent } from "@/apps/web/site-content"');
    expect(header).toContain("{content.siteName}");
    expect(header).toContain('href="/bke"');
    expect(header).toContain("Download BKE");
    expect(footer).toContain("BKES Information Technology Solutions");
    expect(footer).toContain("{content.supportEmail}");
    expect(layout).toContain("generateMetadata");
    expect(layout).toContain("content.heroDescription");
  });

  it("does not retain superseded editable hero copy", async () => {
    const page = await read("app/page.tsx");
    expect(page).not.toContain("Secure products, flexible subscriptions, and practical software");
    expect(page).not.toContain("BUILD WITH CONFIDENCE. SHIP WITH CLARITY.");
    expect(page).not.toContain("Your workflow, <em>backed up,");
  });
});
