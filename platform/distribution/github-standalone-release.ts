import { createHash } from "node:crypto";
import { githubReleaseRepository } from "@/platform/distribution/github-releases";

const MAX_METADATA_BYTES = 64 * 1024;
const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;
const ZIP_EOCD_SEARCH_BYTES = 65_557;
const GITHUB_REQUEST_TIMEOUT_MS = 30_000;
const PACKAGE_CONTENT_TYPE = "application/vnd.bke.update-package+zip";
const RELEASE_METADATA_KEYS = new Set([
  "schema",
  "productId",
  "version",
  "platform",
  "architecture",
  "entryPoint",
  "filename",
  "contentType",
  "bytes",
  "sha256",
]);

export type StandaloneReleaseArchitecture = "x64" | "arm64";

export type StandaloneReleaseContractProof = Readonly<{
  productId: string;
  version: string;
  repository: string;
  tag: string;
  releaseTargetSha: string;
  platform: "windows";
  architecture: StandaloneReleaseArchitecture;
  entryPoint: string;
  metadataAsset: string;
  metadataSha256: string;
  packageAsset: string;
  packageSha256: string;
  packageSize: number;
}>;

export class StandaloneReleaseContractError extends Error {
  constructor(
    public readonly code:
      | "RELEASE_DISTRIBUTION_CONTRACT_INVALID"
      | "RELEASE_DISTRIBUTION_UNAVAILABLE",
    public readonly retryable: boolean,
  ) {
    super(code);
  }
}

type GitHubAsset = Readonly<{
  name: string;
  size: number;
  digest: string;
  browserDownloadUrl: string;
}>;

type ReleaseMetadata = Readonly<{
  schema: "bke.update-package.v1";
  productId: string;
  version: string;
  platform: "windows";
  architecture: StandaloneReleaseArchitecture;
  entryPoint: string;
  filename: string;
  contentType: typeof PACKAGE_CONTENT_TYPE;
  bytes: number;
  sha256: string;
}>;

function invalid(): never {
  throw new StandaloneReleaseContractError(
    "RELEASE_DISTRIBUTION_CONTRACT_INVALID",
    false,
  );
}

function unavailable(): never {
  throw new StandaloneReleaseContractError(
    "RELEASE_DISTRIBUTION_UNAVAILABLE",
    true,
  );
}

async function boundedFetch(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GITHUB_REQUEST_TIMEOUT_MS);
  try {
    return await fetcher(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof StandaloneReleaseContractError) throw error;
    unavailable();
  } finally {
    clearTimeout(timeout);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || !candidate.trim()) invalid();
  return candidate;
}

function parseDigest(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(value)
  ) {
    invalid();
  }
  return value.slice("sha256:".length);
}

function parseGitHubAsset(value: unknown): GitHubAsset {
  const asset = asObject(value);
  const name = requiredString(asset, "name");
  const size = asset.size;
  const digest = parseDigest(asset.digest);
  const browserDownloadUrl = requiredString(asset, "browser_download_url");

  if (!Number.isSafeInteger(size) || Number(size) <= 0) invalid();

  return {
    name,
    size: Number(size),
    digest,
    browserDownloadUrl,
  };
}

function validateGitHubReleaseAssetUrl(
  raw: string,
  repository: string,
  tag: string,
): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    invalid();
  }

  const prefix = `/${repository}/releases/download/${tag}/`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    !url.pathname.startsWith(prefix)
  ) {
    invalid();
  }
}

async function readBoundedMetadata(
  fetcher: typeof fetch,
  asset: GitHubAsset,
  repository: string,
  tag: string,
): Promise<Uint8Array> {
  validateGitHubReleaseAssetUrl(asset.browserDownloadUrl, repository, tag);
  if (asset.size > MAX_METADATA_BYTES) invalid();

  const response = await boundedFetch(fetcher, asset.browserDownloadUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "bke-digital-solutions",
    },
  });
  if (!response.ok) {
    if (response.status >= 500 || response.status === 429) unavailable();
    invalid();
  }

  const announced = Number(response.headers.get("content-length") ?? "0");
  if (announced > MAX_METADATA_BYTES) invalid();

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length <= 0 || bytes.length > MAX_METADATA_BYTES) invalid();
  if (bytes.length !== asset.size || sha256(bytes) !== asset.digest) invalid();

  return bytes;
}

function parseReleaseMetadata(
  bytes: Uint8Array,
  input: Readonly<{
    productId: string;
    version: string;
    architecture: StandaloneReleaseArchitecture;
  }>,
): ReleaseMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    invalid();
  }

  const value = asObject(parsed);
  const keys = Object.keys(value);
  if (
    keys.length !== RELEASE_METADATA_KEYS.size ||
    keys.some((key) => !RELEASE_METADATA_KEYS.has(key))
  ) {
    invalid();
  }

  const schema = requiredString(value, "schema");
  const productId = requiredString(value, "productId");
  const version = requiredString(value, "version");
  const platform = requiredString(value, "platform");
  const architecture = requiredString(value, "architecture");
  const entryPoint = requiredString(value, "entryPoint");
  const filename = requiredString(value, "filename");
  const contentType = requiredString(value, "contentType");
  const packageSha256 = requiredString(value, "sha256").toLowerCase();
  const size = value.bytes;

  if (
    schema !== "bke.update-package.v1" ||
    productId !== input.productId ||
    version !== input.version ||
    platform !== "windows" ||
    architecture !== input.architecture ||
    contentType !== PACKAGE_CONTENT_TYPE ||
    !Number.isSafeInteger(size) ||
    Number(size) <= 0 ||
    Number(size) > 4 * 1024 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(packageSha256) ||
    entryPoint === "." ||
    entryPoint === ".." ||
    entryPoint.includes("/") ||
    entryPoint.includes("\\") ||
    entryPoint.includes(":") ||
    entryPoint.includes("\0") ||
    !filename.endsWith(
      `-Windows-${input.architecture}.update.zip`,
    )
  ) {
    invalid();
  }

  return {
    schema: "bke.update-package.v1",
    productId,
    version,
    platform: "windows",
    architecture: input.architecture,
    entryPoint,
    filename,
    contentType: PACKAGE_CONTENT_TYPE,
    bytes: Number(size),
    sha256: packageSha256,
  };
}

type RangeBytes = Readonly<{
  bytes: Uint8Array;
  total: number;
  start: number;
  end: number;
}>;

function parseContentRange(value: string | null): {
  start: number;
  end: number;
  total: number;
} {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? "");
  if (!match) unavailable();

  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    end < start ||
    total <= end
  ) {
    unavailable();
  }

  return { start, end, total };
}

async function fetchRange(
  fetcher: typeof fetch,
  url: string,
  range: string,
): Promise<RangeBytes> {
  const response = await boundedFetch(fetcher, url, {
    redirect: "follow",
    headers: {
      "User-Agent": "bke-digital-solutions",
      Range: range,
    },
  });

  if (response.status !== 206) unavailable();

  const parsed = parseContentRange(response.headers.get("content-range"));
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== parsed.end - parsed.start + 1) unavailable();

  return { bytes, ...parsed };
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const view = Buffer.from(bytes);
  for (let offset = view.length - 22; offset >= 0; offset -= 1) {
    if (view.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = view.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === view.length) return offset;
  }
  invalid();
}

function centralDirectoryHasRootEntryPoint(
  bytes: Uint8Array,
  expectedEntries: number,
  entryPoint: string,
): boolean {
  const view = Buffer.from(bytes);
  let offset = 0;

  for (let index = 0; index < expectedEntries; index += 1) {
    if (offset + 46 > view.length || view.readUInt32LE(offset) !== 0x02014b50) {
      invalid();
    }

    const fileNameLength = view.readUInt16LE(offset + 28);
    const extraLength = view.readUInt16LE(offset + 30);
    const commentLength = view.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    const next = nameEnd + extraLength + commentLength;

    if (nameEnd > view.length || next > view.length) invalid();

    const name = view.subarray(nameStart, nameEnd).toString("utf8");
    if (name === entryPoint) return true;
    offset = next;
  }

  return false;
}

async function verifyPackageRootEntryPoint(
  fetcher: typeof fetch,
  asset: GitHubAsset,
  repository: string,
  tag: string,
  entryPoint: string,
): Promise<void> {
  validateGitHubReleaseAssetUrl(asset.browserDownloadUrl, repository, tag);

  const tailLength = Math.min(asset.size, ZIP_EOCD_SEARCH_BYTES);
  const tailStart = asset.size - tailLength;
  const tail = await fetchRange(
    fetcher,
    asset.browserDownloadUrl,
    `bytes=${tailStart}-${asset.size - 1}`,
  );
  if (tail.total !== asset.size) invalid();

  const eocdOffset = findEndOfCentralDirectory(tail.bytes);
  const eocd = Buffer.from(tail.bytes);

  const diskNumber = eocd.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = eocd.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = eocd.readUInt16LE(eocdOffset + 8);
  const totalEntries = eocd.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = eocd.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = eocd.readUInt32LE(eocdOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries <= 0 ||
    totalEntries === 0xffff ||
    centralDirectorySize <= 0 ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    centralDirectorySize > MAX_CENTRAL_DIRECTORY_BYTES ||
    centralDirectoryOffset + centralDirectorySize > asset.size
  ) {
    invalid();
  }

  const central = await fetchRange(
    fetcher,
    asset.browserDownloadUrl,
    `bytes=${centralDirectoryOffset}-${centralDirectoryOffset + centralDirectorySize - 1}`,
  );
  if (central.total !== asset.size) invalid();

  if (
    !centralDirectoryHasRootEntryPoint(
      central.bytes,
      totalEntries,
      entryPoint,
    )
  ) {
    invalid();
  }
}

function releaseArchitectures(
  architecture: "x64" | "arm64" | "universal",
): readonly StandaloneReleaseArchitecture[] {
  return architecture === "universal"
    ? ["x64", "arm64"]
    : [architecture];
}

export async function verifyGitHubStandaloneReleaseContract(
  input: Readonly<{
    productId: string;
    version: string;
    platform: "windows";
    architecture: "x64" | "arm64" | "universal";
  }>,
  fetcher: typeof fetch = fetch,
): Promise<readonly StandaloneReleaseContractProof[]> {
  const repository = githubReleaseRepository(input.productId);
  if (!repository || input.platform !== "windows") invalid();

  const tag = `v${input.version}`;
  const [owner, name] = repository.split("/", 2);
  if (!owner || !name) invalid();

  const response = await boundedFetch(
    fetcher,
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases/tags/${encodeURIComponent(tag)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "bke-digital-solutions",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    if (response.status === 404) invalid();
    unavailable();
  }

  let releaseValue: unknown;
  try {
    releaseValue = await response.json();
  } catch {
    invalid();
  }

  const release = asObject(releaseValue);
  if (
    requiredString(release, "tag_name") !== tag ||
    release.draft !== false ||
    release.prerelease !== false
  ) {
    invalid();
  }

  const releaseTargetSha = requiredString(release, "target_commitish");
  if (!/^[a-f0-9]{40}$/.test(releaseTargetSha)) invalid();

  if (!Array.isArray(release.assets)) invalid();
  const assets = release.assets.map(parseGitHubAsset);

  const proofs: StandaloneReleaseContractProof[] = [];
  for (const architecture of releaseArchitectures(input.architecture)) {
    const suffix = `-Windows-${architecture}.update.json`;
    const metadataAssets = assets.filter((asset) =>
      asset.name.endsWith(suffix),
    );
    if (metadataAssets.length !== 1) invalid();

    const metadataAsset = metadataAssets[0];
    const metadataBytes = await readBoundedMetadata(
      fetcher,
      metadataAsset,
      repository,
      tag,
    );
    const metadata = parseReleaseMetadata(metadataBytes, {
      productId: input.productId,
      version: input.version,
      architecture,
    });

    const packageAssets = assets.filter(
      (asset) => asset.name === metadata.filename,
    );
    if (packageAssets.length !== 1) invalid();

    const packageAsset = packageAssets[0];
    validateGitHubReleaseAssetUrl(
      packageAsset.browserDownloadUrl,
      repository,
      tag,
    );
    if (
      packageAsset.size !== metadata.bytes ||
      packageAsset.digest !== metadata.sha256
    ) {
      invalid();
    }

    await verifyPackageRootEntryPoint(
      fetcher,
      packageAsset,
      repository,
      tag,
      metadata.entryPoint,
    );

    proofs.push(Object.freeze({
      productId: input.productId,
      version: input.version,
      repository,
      tag,
      releaseTargetSha,
      platform: "windows",
      architecture,
      entryPoint: metadata.entryPoint,
      metadataAsset: metadataAsset.name,
      metadataSha256: metadataAsset.digest,
      packageAsset: packageAsset.name,
      packageSha256: packageAsset.digest,
      packageSize: packageAsset.size,
    }));
  }

  return Object.freeze(proofs);
}
