import { redirect } from "next/navigation";
import { requireAdmin } from "@/apps/web/auth/session";
import { db } from "@/platform/host/db";
import { AdminProductManager } from "@/components/admin-product-manager";

type ExecutionRow = Readonly<{
  id: string;
  launcherExecutionType: "LAUNCHER_PLUGIN" | "STANDALONE" | null;
}>;

export default async function AdminProducts() {
  await requireAdmin().catch(() => redirect("/login"));

  const [products, executionRows] = await Promise.all([
    db.product.findMany({
      include: {
        editions: {
          include: { purchasePlans: true },
          orderBy: { sortOrder: "asc" },
        },
        versions: { orderBy: { releasedAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.$queryRaw<ExecutionRow[]>`
      SELECT
        "id",
        "launcherExecutionType"::text AS "launcherExecutionType"
      FROM "Product"
    `,
  ]);

  const executionByProduct = new Map(
    executionRows.map((row) => [row.id, row.launcherExecutionType] as const),
  );

  return (
    <section className="shell py-12">
      <p className="font-bold text-[#0b7197]">Administration</p>
      <h1 className="mt-2 text-4xl font-black">Products, editions, and plans</h1>
      <p className="mb-8 mt-3 text-slate-600">
        Define edition capabilities once, offer multiple purchase plans, upload private
        installers, and explicitly choose whether desktop software runs inside Launcher
        or standalone.
      </p>
      <AdminProductManager
        products={products.map((product) => ({
          ...product,
          archivedAt: product.archivedAt?.toISOString() ?? null,
          launcherExecutionType: executionByProduct.get(product.id) ?? null,
        }))}
      />
    </section>
  );
}
