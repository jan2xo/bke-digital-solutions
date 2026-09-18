import { createHash, generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  resolveSignedLicensingAgentUpdate,
  type LicensingAgentArchitecture,
  type LicensingAgentUpdateConfiguration,
} from "../v2/platform/distribution/licensing-agent-update-authority";

const output = process.argv[2];
if (!output) throw new Error("usage: tsx scripts/certify-licensing-agent-signed-update.ts <output.json>");

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const publicJwk = publicKey.export({ format: "jwk" });
if (!publicJwk.x) throw new Error("Ed25519 public JWK is missing x");
const rawPublic = Buffer.from(publicJwk.x, "base64url");
if (rawPublic.length !== 32) throw new Error("Ed25519 public key is not 32 bytes");

const version = "2.0.1-phase9-cert.1";
const issuedAt = new Date("2026-09-19T01:00:00Z");
const artifacts: Record<LicensingAgentArchitecture, Buffer> = {
  x86_64: Buffer.from("MZphase9-cross-repo-x64", "ascii"),
  arm64: Buffer.from("MZphase9-cross-repo-arm64", "ascii"),
};

const configuration: LicensingAgentUpdateConfiguration = {
  latestVersion: version,
  minimumSupportedVersion: "2.0.0",
  revision: 17,
  signingKeyId: "phase9-cross-repo-v1",
  signingPrivateKey: privatePem,
  publishedAt: "2026-09-19T00:30:00Z",
  artifacts: {
    x86_64: {
      sha256: createHash("sha256").update(artifacts.x86_64).digest("hex"),
      size: artifacts.x86_64.length,
    },
    arm64: {
      sha256: createHash("sha256").update(artifacts.arm64).digest("hex"),
      size: artifacts.arm64.length,
    },
  },
};

const fixtures = (["x86_64", "arm64"] as const).map((architecture) => {
  const policy = resolveSignedLicensingAgentUpdate(
    { currentVersion: "2.0.0", platform: "windows", architecture },
    configuration,
    issuedAt,
  );
  const suffix = architecture === "x86_64" ? "x64" : "arm64";
  return {
    architecture,
    policy,
    public_key: rawPublic.toString("base64"),
    artifact_base64: artifacts[architecture].toString("base64"),
    expected_catalog_url:
      `https://github.com/jan2xo/bke-software-catalog/releases/download/bke-licensing-agent-v${version}/BKE-Licensing-Agent-${version}-Windows-${suffix}.exe`,
  };
});

writeFileSync(
  output,
  JSON.stringify(
    {
      schema: "bke.phase9-cross-repository-fixture.v1",
      source: "bke-digital-solutions-v2",
      fixtures,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(`Wrote ${fixtures.length} signed Phase 9 policies to ${output}`);
