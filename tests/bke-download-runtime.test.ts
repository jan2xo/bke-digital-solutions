import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveBkePublicDownloadUrl } from "@/platform/distribution/bke-launcher-download";

describe("BKE customer download runtime", () => {
  it("accepts only canonical BKE Launcher GitHub release assets", () => {
    const canonical =
      "https://github.com/jan2xo/bke-launcher/releases/download/v0.1.0/BKE-0.1.0-Windows-x64.exe";

    expect(resolveBkePublicDownloadUrl({
      BKE_PUBLIC_DOWNLOAD_URL: canonical,
    })).toBe(canonical);

    for (const rejected of [
      "http://github.com/jan2xo/bke-launcher/releases/download/v0.1.0/BKE-0.1.0-Windows-x64.exe",
      "https://example.com/BKE.exe",
      "https://github.com/other/bke-launcher/releases/download/v0.1.0/BKE-0.1.0-Windows-x64.exe",
      "https://github.com/jan2xo/bke-launcher/releases/latest/download/BKE-0.1.0-Windows-x64.exe",
      "https://github.com/jan2xo/bke-launcher/releases/download/v0.1.0/not-bke.exe",
      "https://github.com/jan2xo/bke-launcher/releases/download/v0.1.0/BKE-0.1.0-Windows-x64.zip",
      "https://github.com/jan2xo/bke-launcher/releases/download/v0.1.0/BKE-0.1.0-Windows-x64.exe?token=unexpected",
    ]) {
      expect(resolveBkePublicDownloadUrl({
        BKE_PUBLIC_DOWNLOAD_URL: rejected,
      })).toBeNull();
    }
  });

  it("keeps the public page closed when no release has been configured", () => {
    expect(resolveBkePublicDownloadUrl({})).toBeNull();
  });

  it("passes the stable download variable into the canonical Compose runtime", () => {
    const compose = readFileSync("docker-compose.production.yml", "utf8");
    const page = readFileSync("app/bke/page.tsx", "utf8");

    expect(compose).toContain("- BKE_PUBLIC_DOWNLOAD_URL");
    expect(page).toContain("resolveBkePublicDownloadUrl");
    expect(page).not.toContain("new URL(value)");
  });
});
