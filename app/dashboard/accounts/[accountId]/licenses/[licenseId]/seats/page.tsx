import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/apps/web/auth/session";
import { requireLegalClearance } from "@/apps/web/legal/clearance";
import {
  listAssignableLicenseUsers,
  readLicenseSeatState,
} from "@/apps/web/licensing/license-seat-management";
import { LicenseSeatManager } from "@/components/license-seat-manager";
import { db } from "@/platform/host/db";

export default async function LicenseSeatsPage({
  params,
}: {
  params: Promise<{ accountId: string; licenseId: string }>;
}) {
  const user = await requireUser().catch(() => redirect("/login"));
  const { accountId, licenseId } = await params;
  await requireLegalClearance(
    user.id,
    `/dashboard/accounts/${accountId}/licenses/${licenseId}/seats`,
  );

  const data = await db.$transaction(async (tx) => {
    const state = await readLicenseSeatState(tx, {
      actorId: user.id,
      licenseId,
    });
    if (state.accountId !== accountId) throw new Error("NOT_FOUND");

    const users = await listAssignableLicenseUsers(tx, {
      actorId: user.id,
      licenseId,
    });
    const license = await tx.license.findUniqueOrThrow({
      where: { id: licenseId },
      include: {
        product: { select: { name: true } },
        edition: { select: { name: true } },
      },
    });
    return { state, users, license };
  }, { isolationLevel: "Serializable" }).catch(() => redirect(`/dashboard/accounts/${accountId}`));

  const title = data.license.edition
    ? `${data.license.product.name} — ${data.license.edition.name}`
    : data.license.product.name;

  return <section className="shell py-14">
    <Link className="text-sm font-bold text-sky-300 underline underline-offset-2" href={`/dashboard/accounts/${accountId}`}>
      Back to account
    </Link>
    <p className="mt-7 text-xs font-bold tracking-widest text-[#ffd15a]">LICENSE SEATS</p>
    <h1 className="mt-2 text-4xl font-black">{title}</h1>
    <p className="mt-3 max-w-2xl text-[#a8b5c4]">
      Assign purchased software seats to verified members of this account. Organization members only see software in BKE when they hold an assigned seat.
    </p>
    <div className="mt-8">
      <LicenseSeatManager
        licenseId={licenseId}
        maxSeats={data.state.maxSeats}
        assignments={data.state.assignments.map((assignment) => ({
          ...assignment,
          createdAt: assignment.createdAt.toISOString(),
        }))}
        users={data.users}
      />
    </div>
  </section>;
}
