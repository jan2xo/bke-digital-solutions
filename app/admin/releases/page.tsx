import Link from "next/link";
import { db } from "@/v2/platform/host/db";
import { AdminTable } from "@/components/admin-table";
import { AdminActionButton } from "@/components/admin-action-button";

export default async function Releases() {
  const rows = await db.productVersion.findMany({
    include: { product: true, artifacts: true },
    orderBy: { releasedAt: "desc" },
    take: 250,
  });

  return (
    <section className="shell py-10">
      <h1 className="mb-2 text-4xl font-black">Release catalog</h1>
      <p className="mb-7 text-slate-600">
        GitHub owns software release authority. Digital Solutions records catalog lifecycle and commercial availability only.
      </p>
      <AdminTable
        headers={["Release", "Product", "Lifecycle", "Published", "Assets", "Actions"]}
        rows={rows.map((version) => [
          <Link className="font-bold text-[#3D75A7]" href={`/admin/releases/${version.id}`} key={version.id}>
            {version.version}
          </Link>,
          version.product.name,
          version.lifecycle,
          version.publishedAt ? "Published" : "Hidden",
          String(version.artifacts.length),
          [
            <AdminActionButton
              key="promote"
              url={`/api/admin/versions/${version.id}`}
              label="Promote"
              body={{
                lifecycle:
                  version.lifecycle === "DRAFT"
                    ? "INTERNAL"
                    : version.lifecycle === "INTERNAL"
                      ? "ALPHA"
                      : version.lifecycle === "ALPHA"
                        ? "BETA"
                        : version.lifecycle === "BETA"
                          ? "RELEASE_CANDIDATE"
                          : "STABLE",
              }}
              confirmText="Advance this catalog lifecycle?"
            />,
          ],
        ])}
      />
    </section>
  );
}
