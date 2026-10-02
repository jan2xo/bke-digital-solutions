import { createHash, generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  licensingAgentArtifactId,
  licensingAgentReleaseTag,
  rawEd25519PublicKeyFromPrivate,
  signLicensingAgentUpdatePolicy,
  type LicensingAgentArchitecture,
} from "../platform/distribution/licensing-agent-update-contract";

const output = process.argv[2];
if (!output) {
  throw new Error(
    "usage: tsx scripts/certify-licensing-agent-signed-update.ts <output.json>",
  );
}

const { privateKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey.export({
  format: "pem",
  type: "pkcs8",
}).toString();
const rawPublic = rawEd25519PublicKeyFromPrivate(privatePem);

const currentVersion = "2.0.0";
const latestVersion = "2.0.1-cross-repo-cert.1";
const minimumSupportedVersion = "2.0.0";
const signingKeyId = "agent-cross-repo-cert-v1";
const publishedAt = new Date("2026-10-02T00:00:00Z");
const issuedAt = new Date();

const artifacts: Record<LicensingAgentArchitecture, Buffer> = {
  x86_64: Buffer.from("MZbke-agent-cross-repo-x64", "ascii"),
  arm64: Buffer.from("MZbke-agent-cross-repo-arm64", "ascii"),
};

const fixtures = (["x86_64", "arm64"] as const).map(
  (architecture, index) => {
    const artifact = artifacts[architecture];
    const artifactId = licensingAgentArtifactId(
      latestVersion,
      architecture,
    );
    const policy = signLicensingAgentUpdatePolicy(
      {
        currentVersion,
        platform: "windows",
        architecture,
      },
      {
        latestVersion,
        minimumSupportedVersion,
        revision: 100 + index,
        releaseTag: licensingAgentReleaseTag(latestVersion),
        publishedAt,
        artifact: {
          architecture,
          artifactId,
          sha256: createHash("sha256").update(artifact).digest("hex"),
          size: artifact.length,
        },
        signingKeyId,
        signingPublicKey: rawPublic.toString("base64"),
        signingPrivateKey: privatePem,
      },
      issuedAt,
    );

    return {
      architecture,
      policy,
      public_key: rawPublic.toString("base64"),
      artifact_base64: artifact.toString("base64"),
      expected_catalog_url:
        `https://github.com/jan2xo/bke-software-catalog/releases/download/${policy.release_id}/${policy.artifact_id}`,
    };
  },
);

writeFileSync(
  output,
  JSON.stringify(
    {
      schema: "bke.agent-self-update-cross-repo-fixture.v1",
      source: "bke-digital-solutions",
      fixtures,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  `Wrote ${fixtures.length} signed Agent update policies to ${output}`,
);
