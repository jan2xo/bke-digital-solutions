import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sourcePath = resolve("prisma/schema.prisma");
const temporaryPath = resolve("prisma/.schema.client-js.prisma");
const source = readFileSync(sourcePath, "utf8");
const generatorPattern = /generator\s+client\s*\{[\s\S]*?\}/m;

if (!generatorPattern.test(source)) {
  throw new Error("Prisma client generator block was not found.");
}

const projected = source.replace(
  generatorPattern,
  'generator client {\n  provider = "prisma-client-js"\n}',
);

writeFileSync(temporaryPath, projected);
try {
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["prisma", "generate", "--schema", temporaryPath],
    { stdio: "inherit", env: process.env },
  );
} finally {
  rmSync(temporaryPath, { force: true });
}
