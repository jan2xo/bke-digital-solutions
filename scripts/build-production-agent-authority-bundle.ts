import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { valid } from "semver";

type ReleaseManifest = {
  schema: string;
  status: string;
  version: string;
  update_authority_key_id?: string;
  installers?: {
    x64?: {
      sha256?: string;
      bytes?: number;
      authenticode_status?: string;
    };
    arm64?: {
      sha256?: string;
      bytes?: number;
      authenticode_status?: string;
    };
  };
};

type PublicKeyDocument = {
  schema: string;
  key_id: string;
  algorithm: string;
  public_key: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function insideGitTree(path: string) {
  let current = resolve(path);
  while (true) {
    if (existsSync(resolve(current, ".git"))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function requiredArg(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) fail(`missing ${name}`);
  return process.argv[index + 1]!;
}

const authorization = requiredArg("--authorization");
if (authorization !== "AUTHORIZE_PRODUCTION_AUTHORITY_BUNDLE") {
  fail("exact production authority-bundle authorization token is required");
}

const manifestPath = resolve(requiredArg("--release-manifest"));
const privateKeyPath = resolve(requiredArg("--private-key"));
const publicKeyPath = resolve(requiredArg("--public-key"));
const outputPath = resolve(requiredArg("--output"));
const revisionRaw = requiredArg("--revision");
const minimumSupportedVersion = requiredArg("--minimum-supported-version");
const publishedAtRaw = requiredArg("--published-at");

if (insideGitTree(outputPath)) {
  fail("refusing to write production private-key-derived authority bundle inside a Git working tree");
}

const revision = Number(revisionRaw);
if (!Number.isSafeInteger(revision) || revision < 1) fail("revision must be a positive integer");
if (!valid(minimumSupportedVersion)) fail("minimum supported version must be valid semantic version");

const publishedAt = new Date(publishedAtRaw);
if (Number.isNaN(publishedAt.valueOf())) fail("published-at must be an ISO date/time");

const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8")) as ReleaseManifest;
if (manifest.schema !== "bke.production-release-manifest.v1") fail("unexpected release manifest schema");
if (manifest.status !== "SIGNED_VERIFIED") fail("release manifest is not SIGNED_VERIFIED");
if (!valid(manifest.version)) fail("release manifest version is invalid");

const x64 = manifest.installers?.x64;
const arm64 = manifest.installers?.arm64;
if (!x64 || !arm64) fail("signed release manifest must contain x64 and arm64 installers");

for (const [architecture, installer] of [["x64", x64], ["arm64", arm64]] as const) {
  if (!installer.sha256 || !/^[a-f0-9]{64}$/.test(installer.sha256)) {
    fail(`${architecture} signed SHA-256 is invalid`);
  }
  if (!Number.isSafeInteger(installer.bytes) || Number(installer.bytes) < 2) {
    fail(`${architecture} signed byte size is invalid`);
  }
  if (installer.authenticode_status !== "Valid") {
    fail(`${architecture} Authenticode status is not Valid`);
  }
}

const publicDocument = JSON.parse(readFileSync(publicKeyPath, "utf8")) as PublicKeyDocument;
if (publicDocument.schema !== "bke.update-authority-key.v1") fail("unexpected public key schema");
if (publicDocument.algorithm !== "Ed25519") fail("update authority public key must use Ed25519");
if (!/^[A-Za-z0-9._-]{1,160}$/.test(publicDocument.key_id)) fail("production key ID is malformed");

const rawPublic = Buffer.from(publicDocument.public_key, "base64");
if (rawPublic.length !== 32) fail("production Ed25519 public key must be exactly 32 bytes");

const privatePem = readFileSync(privateKeyPath, "utf8");
const privateKey = createPrivateKey(privatePem);
if (privateKey.asymmetricKeyType !== "ed25519") fail("production private key is not Ed25519");

const derivedJwk = createPublicKey(privateKey).export({ format: "jwk" });
if (!derivedJwk.x) fail("derived Ed25519 public key is missing x");
const derivedRaw = Buffer.from(derivedJwk.x, "base64url");
if (!derivedRaw.equals(rawPublic)) fail("production private/public update-authority keys do not match");

if (
  manifest.update_authority_key_id &&
  manifest.update_authority_key_id !== publicDocument.key_id
) {
  fail("signed release manifest update-authority key ID does not match supplied production key");
}

mkdirSync(dirname(outputPath), { recursive: true });

const environment = {
  BKE_AGENT_UPDATE_LATEST_VERSION: manifest.version,
  BKE_AGENT_UPDATE_MINIMUM_SUPPORTED_VERSION: minimumSupportedVersion,
  BKE_AGENT_UPDATE_REVISION: String(revision),
  BKE_AGENT_UPDATE_SIGNING_KEY_ID: publicDocument.key_id,
  BKE_AGENT_UPDATE_SIGNING_PRIVATE_KEY: Buffer.from(privatePem, "utf8").toString("base64"),
  BKE_AGENT_UPDATE_PUBLISHED_AT: publishedAt.toISOString(),
  BKE_AGENT_UPDATE_WINDOWS_X64_SHA256: x64.sha256!,
  BKE_AGENT_UPDATE_WINDOWS_X64_SIZE: String(x64.bytes),
  BKE_AGENT_UPDATE_WINDOWS_ARM64_SHA256: arm64.sha256!,
  BKE_AGENT_UPDATE_WINDOWS_ARM64_SIZE: String(arm64.bytes),
};

const bundle = {
  schema: "bke.production-agent-authority-bundle.v1",
  release_manifest_sha256: createHash("sha256").update(manifestBytes).digest("hex"),
  source_release_schema: manifest.schema,
  version: manifest.version,
  production_key_id: publicDocument.key_id,
  revision,
  published_at: publishedAt.toISOString(),
  environment,
  deployment_authorized: false,
  catalog_publication_authorized: false,
};

writeFileSync(outputPath, JSON.stringify(bundle, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
try {
  chmodSync(outputPath, 0o600);
} catch {}

console.log("Production Agent authority bundle created.");
console.log(`version=${manifest.version}`);
console.log(`key_id=${publicDocument.key_id}`);
console.log(`release_manifest_sha256=${bundle.release_manifest_sha256}`);
console.log(`output=${outputPath}`);
console.log("PRIVATE KEY WAS NOT PRINTED.");
console.log("DEPLOYMENT REMAINS UNAUTHORIZED.");
