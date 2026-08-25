import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("public site content integration", () => {
  it("uses authoritative content for public homepage and shell copy", async () => {
    const [page, header, footer, layout] = await Promise.all([
      read("app/page.tsx"),
      read("components/header.tsx"),
      read("components/footer.tsx"),
      read("app/layout.tsx"),
    ]);

    expect(page).toContain('import { getSiteContent } from "@/lib/site-content"');
    expect(page).toContain("content.siteName");
    expect(page).toContain("content.heroHeadline");
    expect(page).toContain("content.heroPrimaryHref");
    expect(header).toContain('import { getSiteContent } from "@/lib/site-content"');
    expect(header).toContain("{content.siteName}");
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
