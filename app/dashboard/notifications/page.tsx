import { redirect } from "next/navigation";
import { requireUser } from "@/apps/web/auth/session";
import { requireLegalClearance } from "@/apps/web/legal/clearance";
import { listNotificationsForUser } from "@/apps/web/notifications/center";
import { NotificationInbox } from "@/components/notification-inbox";

export default async function CustomerNotificationsPage() {
  const user = await requireUser().catch(() => redirect("/login"));
  if (user.role === "ADMIN") redirect("/admin/notifications");
  await requireLegalClearance(user.id, "/dashboard/notifications");

  const items = await listNotificationsForUser({
    userId: user.id,
    role: user.role,
    limit: 100,
  });

  return <section className="shell py-14">
    <p className="font-bold text-sky-300">Notification center</p>
    <h1 className="mt-2 text-4xl font-black">Your BKE notifications</h1>
    <p className="mt-3 max-w-2xl text-slate-400">
      Payments, invoices, licensing, trials, renewals, and account notices appear here.
    </p>
    <div className="mt-8">
      <NotificationInbox items={items}/>
    </div>
  </section>;
}
