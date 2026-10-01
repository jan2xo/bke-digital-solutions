import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  StandaloneReleaseContractError,
  verifyGitHubStandaloneReleaseContract,
} from "@/platform/distribution/github-standalone-release";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function fakeZipCentralDirectory(entries: readonly string[]): Buffer {
  const central = Buffer.concat(entries.map((name) => {
    const fileName = Buffer.from(name, "utf8");
    const record = Buffer.alloc(46 + fileName.length);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt16LE(fileName.length, 28);
    fileName.copy(record, 46);
    return record;
  }));

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(0, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([central, eocd]);
}

function partialResponse(bytes: Buffer, range: string): Response {
  let start: number;
  let end: number;

  const suffix = /^bytes=-(\d+)$/.exec(range);
  if (suffix) {
    const length = Number(suffix[1]);
    start = Math.max(0, bytes.length - length);
    end = bytes.length - 1;
  } else {
    const exact = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!exact) throw new Error("unexpected range");
    start = Number(exact[1]);
    end = Number(exact[2]);
  }

  const body = bytes.subarray(start, end + 1);
  return new Response(body, {
    status: 206,
    headers: {
      "content-length": String(body.length),
      "content-range": `bytes ${start}-${end}/${bytes.length}`,
    },
  });
}

function releaseFetch(entries: readonly string[]): typeof fetch {
  const packageBytes = fakeZipCentralDirectory(entries);
  const packageName = "Render-Dock-1.0.3-Windows-x64.update.zip";
  const packageDigest = sha256(packageBytes);
  const metadataName = "Render-Dock-1.0.3-Windows-x64.update.json";
  const metadataBytes = Buffer.from(JSON.stringify({
    schema: "bke.update-package.v1",
    productId: "bke-render-dock",
    version: "1.0.3",
    platform: "windows",
    architecture: "x64",
    entryPoint: "RENDER DOCK.exe",
    filename: packageName,
    contentType: "application/vnd.bke.update-package+zip",
    bytes: packageBytes.length,
    sha256: packageDigest,
  }));

  const release = {
    tag_name: "v1.0.3",
    draft: false,
    prerelease: false,
    target_commitish: "7a7c82bf9c7c135b1c744e6ada550cda356e4da4",
    assets: [
      {
        name: metadataName,
        size: metadataBytes.length,
        digest: `sha256:${sha256(metadataBytes)}`,
        browser_download_url:
          `https://github.com/jan2xo/BKE_RENDER_DOCK/releases/download/v1.0.3/${metadataName}`,
      },
      {
        name: packageName,
        size: packageBytes.length,
        digest: `sha256:${packageDigest}`,
        browser_download_url:
          `https://github.com/jan2xo/BKE_RENDER_DOCK/releases/download/v1.0.3/${packageName}`,
      },
    ],
  };

  return (async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.startsWith("https://api.github.com/")) {
      return Response.json(release);
    }
    if (url.endsWith(metadataName)) {
      return new Response(metadataBytes, {
        status: 200,
        headers: { "content-length": String(metadataBytes.length) },
      });
    }
    if (url.endsWith(packageName)) {
      const range = new Headers(init?.headers).get("range");
      if (!range) throw new Error("package request must be bounded");
      return partialResponse(packageBytes, range);
    }

    throw new Error(`unexpected URL: ${url}`);
  }) as typeof fetch;
}

describe("standalone GitHub release contract", () => {
  it("verifies exact metadata, GitHub digest, and root package entry point", async () => {
    const proofs = await verifyGitHubStandaloneReleaseContract({
      productId: "bke-render-dock",
      version: "1.0.3",
      platform: "windows",
      architecture: "x64",
    }, releaseFetch([
      "RENDER DOCK.exe",
      "BKE_RENDER_DOCK.dll",
    ]));

    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({
      productId: "bke-render-dock",
      version: "1.0.3",
      repository: "jan2xo/BKE_RENDER_DOCK",
      tag: "v1.0.3",
      releaseTargetSha: "7a7c82bf9c7c135b1c744e6ada550cda356e4da4",
      platform: "windows",
      architecture: "x64",
      entryPoint: "RENDER DOCK.exe",
    });
    expect(proofs[0].packageSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a package whose signed entry point is nested instead of at ZIP root", async () => {
    await expect(
      verifyGitHubStandaloneReleaseContract({
        productId: "bke-render-dock",
        version: "1.0.3",
        platform: "windows",
        architecture: "x64",
      }, releaseFetch([
        "NDER_DOCK/artifacts/publish/win-x64/RENDER DOCK.exe",
      ])),
    ).rejects.toMatchObject<Partial<StandaloneReleaseContractError>>({
      code: "RELEASE_DISTRIBUTION_CONTRACT_INVALID",
      retryable: false,
    });
  });

  it("fails closed when the stable release lacks the modern updater metadata contract", async () => {
    const fetcher = (async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (!url.startsWith("https://api.github.com/")) {
        throw new Error("unexpected non-API request");
      }
      return Response.json({
        tag_name: "v1.0.0",
        draft: false,
        prerelease: false,
        target_commitish: "38e7ea8b21dcfe01e1f08d8691971bc3b1f83c43",
        assets: [{
          name: "Air-Stack-1.0.0-Windows-x64.exe",
          size: 1,
          digest: "sha256:" + "a".repeat(64),
          browser_download_url:
            "https://github.com/jan2xo/BKE_AIR_STACK/releases/download/v1.0.0/Air-Stack-1.0.0-Windows-x64.exe",
        }],
      });
    }) as typeof fetch;

    await expect(
      verifyGitHubStandaloneReleaseContract({
        productId: "bke-air-stack",
        version: "1.0.0",
        platform: "windows",
        architecture: "x64",
      }, fetcher),
    ).rejects.toMatchObject<Partial<StandaloneReleaseContractError>>({
      code: "RELEASE_DISTRIBUTION_CONTRACT_INVALID",
      retryable: false,
    });
  });
});
