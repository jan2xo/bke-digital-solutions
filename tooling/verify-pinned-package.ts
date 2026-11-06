import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, readdir, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Release = Readonly<{ name: string; version: string; url: string; sha256: string }>;
type Lock = { packages: Record<string, { version?: string; resolved?: string; integrity?: string }> };

/** Run by the existing unprivileged adoption certification, never application requests. */
export async function verifyPinnedPackage(release: Release): Promise<void> {
  const root = process.cwd();
  const committedLock = await readFile(resolve(root, "package-lock.json"), "utf8");
  const lock = JSON.parse(committedLock) as Lock;
  const entry = lock.packages["node_modules/" + release.name];
  if (entry?.version !== release.version || entry.resolved !== release.url) {
    throw new Error("PINNED_RELEASE_LOCK_MISMATCH:" + release.name);
  }
  const response = await fetch(release.url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("PINNED_RELEASE_HTTP:" + response.status);
  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.length > 2 * 1024 * 1024 ||
      createHash("sha256").update(archive).digest("hex") !== release.sha256) {
    throw new Error("PINNED_RELEASE_DIGEST_MISMATCH:" + release.name);
  }
  const integrity = "sha512-" + createHash("sha512").update(archive).digest("base64");
  if (entry.integrity !== integrity) throw new Error("PINNED_RELEASE_INTEGRITY_MISMATCH:" + release.name);

  const temporary = await mkdtemp(join(tmpdir(), "bke-package-adoption-"));
  try {
    const archivePath = join(temporary, "release.tgz");
    const unpacked = join(temporary, "unpacked");
    await mkdir(unpacked);
    await writeFile(archivePath, archive);
    const paths = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" }).trim().split("\n");
    if (paths.some((path) => !path.startsWith("package/") || path.split("/").includes(".."))) {
      throw new Error("PINNED_RELEASE_ARCHIVE_PATH:" + release.name);
    }
    execFileSync("tar", ["-xzf", archivePath, "-C", unpacked]);
    let files = 0;
    async function compare(directory: string, relative: string): Promise<void> {
      for (const name of await readdir(directory)) {
        const file = join(directory, name);
        const child = relative ? relative + "/" + name : name;
        const stat = await lstat(file);
        if (stat.isDirectory()) await compare(file, child);
        else {
          if (!stat.isFile()) throw new Error("PINNED_RELEASE_ARCHIVE_TYPE:" + release.name);
          const [expected, actual] = await Promise.all([
            readFile(file), readFile(resolve(root, "node_modules", release.name, child)),
          ]);
          if (!expected.equals(actual)) throw new Error("PINNED_RELEASE_INSTALLED_DRIFT:" + release.name + "/" + child);
          files += 1;
        }
      }
    }
    const metadata = JSON.parse(await readFile(join(unpacked, "package", "package.json"), "utf8")) as { name?: string; version?: string };
    if (metadata.name !== release.name || metadata.version !== release.version) {
      throw new Error("PINNED_RELEASE_METADATA_MISMATCH:" + release.name);
    }
    await compare(join(unpacked, "package"), "");

    console.log("Pinned package adoption GREEN: " + release.name + "@" + release.version +
      "; installedFiles=" + files + "; sha256=" + release.sha256 + "; releaseBytes=VERIFIED");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
