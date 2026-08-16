import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const version = process.argv[2] ?? process.env.RELEASE_VERSION;
const output = process.argv[3] ?? (version ? `.supply-chain/${version}/dependencies.json` : ".supply-chain/dependencies.json");
if (!version || !/^[A-Za-z0-9._-]{1,128}$/.test(version)) { console.error("Usage: npm run supplychain:dependencies -- <release-version> [output-file]"); process.exit(2); }
const lockfile = await readFile("package-lock.json");
const lock = JSON.parse(lockfile.toString("utf8"));
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const result = { format: "bke.dependency-evidence.v1", releaseVersion: version, generatedAt: new Date().toISOString(), node: process.version, npm: null, packageLock: { sha256: createHash("sha256").update(lockfile).digest("hex"), bytes: lockfile.length, lockfileVersion: lock.lockfileVersion }, package: { name: packageJson.name, version: packageJson.version }, lockConsistency: { status: "FAILED", output: "" }, resolution: { status: "FAILED", output: "" }, audit: { status: "FAILED", output: "" } };
const capture = async (command, args) => { try { const value = await exec(command, args, { maxBuffer: 16 * 1024 * 1024 }); return { status: "PASS", output: value.stdout.trim().slice(-20000) }; } catch (error) { return { status: "FAILED", output: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim().slice(-20000) }; } };
result.npm = (await capture("npm", ["--version"])).output;
result.lockConsistency = await capture("npm", ["ci", "--ignore-scripts", "--dry-run"]);
result.resolution = await capture("npm", ["ls", "--all", "--json"]);
result.audit = await capture("npm", ["audit", "--json", "--omit=dev"]);
await mkdir(dirname(output), { recursive: true });
const serialized = JSON.stringify(result, null, 2) + "\n";
await writeFile(output, serialized, { mode: 0o600 });
console.log(JSON.stringify({ output, sha256: createHash("sha256").update(serialized).digest("hex"), lockConsistency: result.lockConsistency.status, resolution: result.resolution.status, audit: result.audit.status }));
if ([result.lockConsistency.status, result.resolution.status, result.audit.status].some((status) => status !== "PASS")) process.exitCode = 1;
