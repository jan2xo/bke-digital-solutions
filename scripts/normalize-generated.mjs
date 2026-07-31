import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const generatedFiles = files("generated/prisma").filter((path) => path.endsWith(".ts"));
let targets = generatedFiles;
if (existsSync(".git")) {
  const outputs = [
    execFileSync("git", ["diff", "--name-only", "--", "generated/prisma"], { encoding: "utf8" }),
    execFileSync("git", ["diff", "--cached", "--name-only", "--", "generated/prisma"], { encoding: "utf8" }),
    execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", "generated/prisma"], { encoding: "utf8" }),
  ];
  const changed = new Set(outputs.flatMap((output) => output.trim().split("\n").filter(Boolean)));
  targets = generatedFiles.filter((file) => changed.has(file));
}
for (const file of targets) {
  const source = readFileSync(file, "utf8");
  const normalized = source.replace(/[ \t]+$/gm, "");
  if (normalized !== source) writeFileSync(file, normalized);
}
