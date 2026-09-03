import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const resolutionExtensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];
const forbiddenRoots = ["lib", "prisma", "generated/prisma"];

function normalize(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function filesUnder(path) {
  if (!existsSync(path)) return [];
  const files = [];
  const visit = (current) => {
    for (const name of readdirSync(current)) {
      const child = join(current, name);
      const info = statSync(child);
      if (info.isDirectory()) visit(child);
      else if (sourceExtensions.has(extname(child))) files.push(resolve(child));
    }
  };
  visit(path);
  return files;
}

function collectEntrypoints() {
  const entries = filesUnder(resolve(root, "app"));
  for (const name of ["middleware.ts", "middleware.tsx", "proxy.ts", "instrumentation.ts", "instrumentation-client.ts"]) {
    const candidate = resolve(root, name);
    if (existsSync(candidate)) entries.push(candidate);
  }
  return [...new Set(entries)].sort();
}

function isInsideRepo(path) {
  const rel = normalize(path);
  return rel !== ".." && !rel.startsWith("../");
}

function isForbidden(path) {
  const rel = normalize(path);
  return forbiddenRoots.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`));
}

function resolveLocalImport(fromFile, specifier) {
  let base;
  if (specifier.startsWith("@/")) base = resolve(root, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return null;

  const candidates = [];
  for (const extension of resolutionExtensions) candidates.push(`${base}${extension}`);
  for (const extension of resolutionExtensions.slice(1)) candidates.push(join(base, `index${extension}`));

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const info = statSync(candidate);
    if (info.isFile() && isInsideRepo(candidate)) return resolve(candidate);
  }
  return null;
}

function moduleSpecifiers(file) {
  const source = readFileSync(file, "utf8");
  const kind = extname(file) === ".tsx" || extname(file) === ".jsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const found = [];

  const addLiteral = (node) => {
    if (node && ts.isStringLiteralLike(node)) found.push(node.text);
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addLiteral(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (ts.isExternalModuleReference(ref)) addLiteral(ref.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const commonJsRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (dynamicImport || commonJsRequire) addLiteral(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...new Set(found)];
}

const entries = collectEntrypoints();
if (entries.length === 0) throw new Error("No production Next.js host entrypoints found under app/.");

const queue = [];
const seen = new Set();
const parent = new Map();
const edgeSpecifier = new Map();
for (const entry of entries) {
  seen.add(entry);
  parent.set(entry, null);
  queue.push(entry);
}

for (let index = 0; index < queue.length; index += 1) {
  const file = queue[index];
  for (const specifier of moduleSpecifiers(file)) {
    const dependency = resolveLocalImport(file, specifier);
    if (!dependency || seen.has(dependency)) continue;
    seen.add(dependency);
    parent.set(dependency, file);
    edgeSpecifier.set(dependency, specifier);
    queue.push(dependency);
  }
}

const legacyFiles = [...seen].filter(isForbidden).sort((a, b) => normalize(a).localeCompare(normalize(b)));

function chainFor(file) {
  const chain = [];
  let current = file;
  while (current) {
    const previous = parent.get(current);
    if (previous === null || previous === undefined) {
      chain.push(normalize(current));
      break;
    }
    chain.push(`${normalize(current)}  <=  ${edgeSpecifier.get(current)}`);
    current = previous;
  }
  return chain.reverse();
}

console.log(`V2 production host dependency graph: entrypoints=${entries.length} reachableLocalFiles=${seen.size}`);
if (legacyFiles.length === 0) {
  console.log("V2 PRODUCTION HOST V1-FREE GREEN: no reachable root lib/, prisma/, or generated/prisma implementation.");
  process.exit(0);
}

console.error(`V2 PRODUCTION HOST V1 REACH-THROUGH DETECTED: ${legacyFiles.length} reachable legacy files.`);
for (const file of legacyFiles) {
  console.error(`\nLEGACY: ${normalize(file)}`);
  for (const line of chainFor(file)) console.error(`  ${line}`);
}
console.error("\nMove required host infrastructure into V2-owned platform/host adapters and route business behavior through @bke/* capabilities. Do not allowlist V1 runtime implementation.");
process.exit(1);
