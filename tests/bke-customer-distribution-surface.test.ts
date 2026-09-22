import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("BKE-only customer distribution surface", () => {
  it("routes public and customer download UX through BKE", async () => {
    const [header, bkePage, dashboard, accountPage, licenseCard] = await Promise.all([
      read("components/header.tsx"),
      read("app/bke/page.tsx"),
      read("app/dashboard/page.tsx"),
      read("app/dashboard/accounts/[id]/page.tsx"),
      read("components/customer-license-card.tsx"),
    ]);

    expect(header).toContain('href="/bke"');
    expect(header).toContain("Download BKE");
    expect(bkePage).toContain("BKE_PUBLIC_DOWNLOAD_URL");
    expect(bkePage).toContain("canonical customer download surface");
    expect(dashboard).toContain('href="/bke"');
    expect(licenseCard).toContain('href="/bke"');
    expect(licenseCard).not.toContain("/download");
    expect(accountPage).not.toContain("githubLatestReleaseUrl");
    expect(accountPage).not.toContain("downloadAvailable");
  });

  it("does not pretend an uncertified BKE installer exists", async () => {
    const page = await read("app/bke/page.tsx");
    expect(page).toContain("BKE installer publishing is being prepared.");
    expect(page).toContain('url.protocol === "https:"');
  });
});
