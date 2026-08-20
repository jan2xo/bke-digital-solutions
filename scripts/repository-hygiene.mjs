import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "-z"]).toString().split("\0").filter(Boolean);
const forbiddenArtifacts = files.filter((file) => /(^|\/)(\.env(?!\.example$)|playwright-report|test-results|coverage|\.next|node_modules)(\/|$)/.test(file) || /\.(log|tsbuildinfo)$/.test(file));
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{12,}\b/,
  /\bre_(?:live|test)_[A-Za-z0-9]{12,}\b/,
  /\bwhsec_[A-Za-z0-9]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bnpm_[A-Za-z0-9]{30,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
];
const secretFiles = [];
const unsafeLogs = [];
for (const file of files) {
  if (/\.(png|jpe?g|gif|ico|bin|woff2?|pdf|lock)$/i.test(file)) continue;
  let content;
  try { content = readFileSync(file, "utf8"); } catch { continue; }
  if (secretPatterns.some((pattern) => pattern.test(content))) secretFiles.push(file);
  if (/console\.(?:log|info|warn|error)\([^\n]*(?:password|authorization|cookie|signature|licenseKey|checkoutUrl|rawPayload)/i.test(content)) unsafeLogs.push(file);
}
if (forbiddenArtifacts.length || secretFiles.length || unsafeLogs.length) {
  console.error(JSON.stringify({ forbiddenArtifacts, secretFiles, unsafeLogs }, null, 2));
  process.exit(1);
}
console.info(`Repository hygiene passed for ${files.length} tracked files.`);
