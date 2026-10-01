import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("BKE-only customer distribution surface", () => {
  it("routes public and customer download UX through BKE", async () => {
    const [
      header,
      bkePage,
      distribution,
      dashboard,
      accountPage,
      licenseCard,
    ] = await Promise.all([
      read("components/header.tsx"),
      read("app/bke/page.tsx"),
      read("platform/distribution/bke-launcher-download.ts"),
      read("app/dashboard/page.tsx"),
      read("app/dashboard/accounts/[accountId]/page.tsx"),
      read("components/customer-license-card.tsx"),
    ]);

    expect(header).toContain('href="/bke"');
    expect(header).toContain("Download BKE");
    expect(bkePage).toContain("resolveBkePublicDownloadUrl");
    expect(distribution).toContain("BKE_PUBLIC_DOWNLOAD_URL");
    expect(bkePage).toContain("canonical customer download surface");
    expect(dashboard).toContain('href="/bke"');
    expect(dashboard).toContain('href="/redeem"');
    expect(accountPage).toContain("GiftClaimCodes");
    expect(accountPage).toContain("manageSeatsHref");
    expect(licenseCard).toContain("manageSeatsHref");
    expect(licenseCard).toContain('href="/bke"');
    expect(licenseCard).not.toContain("/download");
    expect(accountPage).not.toContain("githubLatestReleaseUrl");
    expect(accountPage).not.toContain("downloadAvailable");
  });

  it("does not pretend an uncertified BKE installer exists", async () => {
    const [page, distribution] = await Promise.all([
      read("app/bke/page.tsx"),
      read("platform/distribution/bke-launcher-download.ts"),
    ]);
    expect(page).toContain("BKE installer publishing is being prepared.");
    expect(distribution).toContain('url.protocol !== "https:"');
    expect(distribution).toContain('url.hostname !== "github.com"');
    expect(distribution).toContain("BKE_RELEASE_DOWNLOAD_PATTERN");
  });
});
