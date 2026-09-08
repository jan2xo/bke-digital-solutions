import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ReleaseArtifactControls } from "@/components/release-artifact-controls";
import { AdminActionButton } from "@/components/admin-action-button";

export default async function ReleaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const versionId = (await params).id;
  const version = await db.productVersion.findUnique({
    where: { id: versionId },
    include: { product: true, artifacts: true },
  });
  if (!version) notFound();

  const nextLifecycle =
    version.lifecycle === "DRAFT"
      ? "INTERNAL"
      : version.lifecycle === "INTERNAL"
        ? "ALPHA"
        : version.lifecycle === "ALPHA"
          ? "BETA"
          : version.lifecycle === "BETA"
            ? "RELEASE_CANDIDATE"
            : "STABLE";

  return (
    <main className="shell py-10">
      <Link href="/admin/releases" className="text-sm font-bold text-[#3D75A7]">
        ← Release catalog
      </Link>
      <h1 className="mt-3 text-4xl font-black">
        {version.product.name} {version.version}
      </h1>
      <p className="mt-2 text-slate-600">
        {version.lifecycle} · {version.operatingSystem} {version.architecture} · {version.publishedAt ? "catalog published" : "catalog hidden"}
      </p>

      <section className="card mt-8 p-6">
        <h2 className="text-2xl font-black">Software release authority</h2>
        <p className="mt-2 text-slate-600">
          Build, tests, malware scanning, optional signing/checksum checks, and release publication are owned by GitHub Actions and GitHub Releases.
        </p>
        <p className="mt-3 text-sm text-slate-600">
          Digital Solutions does not certify release evidence. This page controls catalog metadata and commercial availability only.
        </p>
      </section>

      <section className="card mt-8 p-6">
        <h2 className="text-2xl font-black">Licensing availability</h2>
        <p className="mt-1 text-sm text-slate-600">
          Independent from GitHub release authority. Enabled versions may receive commercial leases when the license policy accepts the requested version.
        </p>
        <p className="mt-3 font-bold">
          Current:{" "}
          <span className={version.active ? "text-green-700" : "text-red-700"}>
            {version.active ? "ENABLED" : "DISABLED"}
          </span>
        </p>
        <div className="mt-3">
          {version.active ? (
            <AdminActionButton
              url={`/api/admin/versions/${version.id}/licensing`}
              label="Disable for Licensing"
              body={{ active: false }}
              confirmText="Disable commercial lease issuance for this exact version?"
            />
          ) : (
            <AdminActionButton
              url={`/api/admin/versions/${version.id}/licensing`}
              label="Enable for Licensing"
              body={{ active: true }}
              confirmText="Enable commercial lease issuance for this exact version?"
            />
          )}
        </div>
      </section>

      <section className="card mt-8 p-6">
        <h2 className="text-2xl font-black">Catalog lifecycle</h2>
        <p className="mt-1 text-sm text-slate-600">
          Lifecycle and visibility describe the Digital Solutions catalog; they do not approve or certify software bytes.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {!['STABLE', 'LTS', 'DEPRECATED', 'ARCHIVED'].includes(version.lifecycle) && (
            <AdminActionButton
              url={`/api/admin/versions/${version.id}`}
              label="Promote"
              body={{ lifecycle: nextLifecycle }}
              confirmText="Advance this catalog lifecycle?"
            />
          )}
          {["STABLE", "LTS"].includes(version.lifecycle) && !version.publishedAt && (
            <AdminActionButton
              url={`/api/admin/versions/${version.id}`}
              label="Show in Catalog"
              body={{ published: true }}
              confirmText="Show this GitHub-released version in the customer catalog?"
            />
          )}
          {version.publishedAt && (
            <AdminActionButton
              url={`/api/admin/versions/${version.id}`}
              label="Hide from Catalog"
              body={{ published: false }}
              confirmText="Hide this version from the customer catalog?"
            />
          )}
        </div>
      </section>

      <section className="card mt-8 p-6">
        <h2 className="text-2xl font-black">Legacy-hosted artifacts — transition</h2>
        <p className="mt-1 text-sm text-slate-600">
          Existing artifact records remain available during the distribution migration. The target distribution authority is GitHub Releases.
        </p>
        <div className="mt-4 grid gap-3">
          {version.artifacts.map((artifact) => (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded border p-3" key={artifact.id}>
              <span>
                <strong>{artifact.name}</strong>
                <br />
                <code className="text-xs">{artifact.sha256}</code>
              </span>
              <ReleaseArtifactControls artifactId={artifact.id} active={artifact.active} />
            </div>
          ))}
        </div>
        <ReleaseArtifactControls versionId={version.id} />
      </section>
    </main>
  );
}
