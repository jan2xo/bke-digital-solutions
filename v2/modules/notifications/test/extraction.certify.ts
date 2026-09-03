import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function filesUnder(root: string): string[] {
  const absolute = resolve(moduleRoot, root);
  if (!existsSync(absolute)) throw new Error(`Missing Notifications extraction root: ${root}`);
  const files: string[] = [];
  const visit = (path: string) => {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      if (statSync(child).isDirectory()) visit(child);
      else if (child.endsWith(".ts")) files.push(child);
    }
  };
  visit(absolute);
  return files;
}

const reusableFiles = [
  ...filesUnder("contracts"),
  ...filesUnder("logic"),
  resolve(moduleRoot, "module.manifest.ts"),
];

const at = "@";
const forbiddenMarkers = [
  `from \"${at}bke/`,
  `from '${at}bke/`,
  `from \"${at}/`,
  `from '${at}/`,
  'from "next/',
  "from 'next/",
  'from "server-only"',
  "from 'server-only'",
  "/v2/platform/",
  "/v2/apps/",
  "../../contracts/capability",
];

for (const file of reusableFiles) {
  const source = readFileSync(file, "utf8");
  for (const marker of forbiddenMarkers) {
    if (source.includes(marker)) {
      throw new Error(
        `Notifications reusable surface leaks host/cross-library dependency: ${relative(moduleRoot, file)} -> ${marker}`,
      );
    }
  }
}

for (const forbiddenPath of ["prisma", "repositories", "providers"]) {
  if (existsSync(resolve(moduleRoot, forbiddenPath))) {
    throw new Error(`Notifications foundation must remain persistence/transport free: ${forbiddenPath}`);
  }
}

const manifestSource = readFileSync(resolve(moduleRoot, "module.manifest.ts"), "utf8");
if (!manifestSource.includes("NotificationsModuleManifest")) {
  throw new Error("Notifications package manifest must use its package-local manifest contract.");
}
if (!manifestSource.includes("needs: []")) {
  throw new Error("Notifications package manifest must remain independently composable with needs: [].");
}
if (!manifestSource.includes("NOTIFICATIONS_INTENT_CAPABILITY_ID")) {
  throw new Error("Notifications package manifest must provide the intent capability.");
}

const hostModuleSource = readFileSync(resolve(moduleRoot, "module.ts"), "utf8");
if (!hostModuleSource.includes("CapabilityModule")) {
  throw new Error("Digital Solutions must retain the host CapabilityModule adapter for Notifications.");
}

console.log(
  `Notifications extraction boundary GREEN: reusableFiles=${reusableFiles.length} persistence=none transport=none`,
);
