import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modulesRoot = resolve(repositoryRoot, "modules");
const architectureRoots = [
  resolve(repositoryRoot, "apps"),
  resolve(repositoryRoot, "contracts"),
  modulesRoot,
  resolve(repositoryRoot, "platform"),
  resolve(repositoryRoot, "tooling"),
];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);

function extension(path) {
  const index = path.lastIndexOf(".");
  return index === -1 ? "" : path.slice(index);
}

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      files.push(...collectFiles(path));
    } else if (sourceExtensions.has(extension(path))) {
      files.push(path);
    }
  }
  return files;
}

function importsFrom(source) {
  const imports = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      imports.push(match[1]);
    }
  }
  return imports;
}

function resolveLocalImport(sourceFile, specifier) {
  if (specifier.startsWith(".")) {
    return resolve(dirname(sourceFile), specifier);
  }
  if (specifier.startsWith("@/")) {
    return resolve(repositoryRoot, specifier.slice(2));
  }
  if (specifier.startsWith("v2/")) {
    return resolve(repositoryRoot, specifier);
  }
  return null;
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function isWithinArchitecture(target) {
  return architectureRoots.some((root) => isWithin(root, target));
}

const violations = [];

for (const sourceFile of collectFiles(modulesRoot)) {
  const sourceRelative = relative(modulesRoot, sourceFile);
  const ownerModule = sourceRelative.split(sep)[0];
  const source = readFileSync(sourceFile, "utf8");

  for (const specifier of importsFrom(source)) {
    const target = resolveLocalImport(sourceFile, specifier);
    if (!target) {
      continue;
    }

    if (!isWithinArchitecture(target)) {
      violations.push(
        `${relative(repositoryRoot, sourceFile)} imports legacy/root implementation ${specifier}`,
      );
      continue;
    }

    if (!isWithin(modulesRoot, target)) {
      continue;
    }

    const targetRelative = relative(modulesRoot, target).split(sep);
    const targetModule = targetRelative[0];
    if (targetModule === ownerModule) {
      continue;
    }

    if (targetRelative[1] !== "contracts") {
      violations.push(
        `${relative(repositoryRoot, sourceFile)} reaches private module ${targetModule} through ${specifier}`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("Module boundary violations:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log("Module boundaries GREEN");
