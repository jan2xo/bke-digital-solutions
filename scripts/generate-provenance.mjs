import { writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await mkdir(".supply-chain", { recursive: true });
const run = (args) => { try { return execFileSync("git", args, { encoding: "utf8" }).trim(); } catch { return "unknown"; } };
const provenance = { releaseIdentifier: process.env.RELEASE_VERSION ?? "unreleased", commitHash: process.env.GIT_COMMIT ?? run(["rev-parse", "HEAD"]), branch: process.env.GIT_BRANCH ?? run(["branch", "--show-current"]), buildEnvironment: process.env.BUILD_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown", builderIdentity: process.env.BUILDER_IDENTITY ?? "unidentified", builtAt: new Date().toISOString() };
await writeFile(process.env.PROVENANCE_OUTPUT ?? ".supply-chain/provenance.json", JSON.stringify(provenance, null, 2) + "\n");
console.log(JSON.stringify(provenance));
