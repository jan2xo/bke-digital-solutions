import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const generatedFiles = files("generated/prisma").filter((path) => path.endsWith(".ts"));
for (const file of generatedFiles) {
  const source = readFileSync(file, "utf8");
  const normalized = source.replace(/[ \t]+$/gm, "");
  if (normalized !== source) writeFileSync(file, normalized);
}
