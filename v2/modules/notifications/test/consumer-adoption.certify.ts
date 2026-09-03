import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_RELEASE =
  "https://github.com/jan2xo/bke-libraries-typescript/releases/download/notifications-v0.1.0/bke-notifications-0.1.0.tgz";
const EXPECTED_VERSION = "0.1.0";
const EXPECTED_SHA256 =
  "9a9c5640ed27332886e54c491cb6b54fdcc6561ec100ddd2476adb02d93ee406";
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const [moduleSource, packageSource, lockSource, nextConfigSource, workflowSource, standaloneSource] =
  await Promise.all([
    readFile(new URL("../module.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../package.json", import.meta.url), "utf8"),
    readFile(new URL("../../../../package-lock.json", import.meta.url), "utf8"),
    readFile(new URL("../../../../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../../.github/workflows/v2-notifications.yml", import.meta.url), "utf8"),
    readFile(new URL("../../../apps/standalone/bootstrap.ts", import.meta.url), "utf8"),
  ]);

if (!moduleSource.includes("CapabilityModule") || !moduleSource.includes('"../../contracts/capability"')) {
  throw new Error("Notifications host adapter must retain the Digital Solutions CapabilityModule contract.");
}

for (const marker of [
  "@bke/notifications/contracts/notification-intent.contract",
  "@bke/notifications/logic/notification-intent",
  "@bke/notifications/module.manifest",
]) {
  if (!moduleSource.includes(marker)) {
    throw new Error(`Notifications host adapter is missing package surface: ${marker}`);
  }
}

for (const marker of ['"./contracts/', '"./logic/', '"./module.manifest"']) {
  if (moduleSource.includes(marker)) {
    throw new Error(`Notifications host adapter still consumes staging implementation: ${marker}`);
  }
}

const packageJson = JSON.parse(packageSource) as { dependencies?: Record<string, string> };
if (packageJson.dependencies?.["@bke/notifications"] !== EXPECTED_RELEASE) {
  throw new Error(
    `Digital Solutions package.json does not pin the certified Notifications artifact: ${packageJson.dependencies?.["@bke/notifications"]}`,
  );
}

const packageLock = JSON.parse(lockSource) as {
  packages?: Record<
    string,
    {
      dependencies?: Record<string, string>;
      version?: string;
      resolved?: string;
      integrity?: string;
    }
  >;
};
if (packageLock.packages?.[""]?.dependencies?.["@bke/notifications"] !== EXPECTED_RELEASE) {
  throw new Error("Digital Solutions package-lock root does not pin the certified Notifications artifact.");
}

const lockedNotifications = packageLock.packages?.["node_modules/@bke/notifications"];
if (
  lockedNotifications?.version !== EXPECTED_VERSION ||
  lockedNotifications.resolved !== EXPECTED_RELEASE ||
  !lockedNotifications.integrity
) {
  throw new Error(
    `Digital Solutions Notifications lock entry is incomplete or drifted: ${JSON.stringify(lockedNotifications)}`,
  );
}

if (!nextConfigSource.includes('"@bke/notifications"')) {
  throw new Error("Next.js must explicitly transpile the source-native @bke/notifications package.");
}

for (const marker of [EXPECTED_RELEASE, EXPECTED_SHA256, "Certify Notifications consumer adoption"]) {
  if (!workflowSource.includes(marker)) {
    throw new Error(`Notifications CI is missing package-backed adoption guardrail: ${marker}`);
  }
}

if (!standaloneSource.includes("notificationsModule") || !standaloneSource.includes('"notifications"')) {
  throw new Error("The standalone host must compose package-backed Notifications as an actual module.");
}

for (const stagingPath of [
  "contracts",
  "docs",
  "logic",
  "module.manifest.ts",
  "test/notification-intent.test.ts",
  "test/extraction.certify.ts",
]) {
  if (!existsSync(resolve(moduleRoot, stagingPath))) {
    throw new Error(`Notifications staging must remain during adoption certification: ${stagingPath}`);
  }
}

console.log(
  `Notifications package-backed consumer adoption GREEN; version=${EXPECTED_VERSION} integrity=${lockedNotifications.integrity}`,
);
