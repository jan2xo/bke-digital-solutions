import { requireAdmin } from "@/apps/web/auth/session";
import { listNotificationsForUser } from "@/apps/web/notifications/center";
import { NotificationInbox } from "@/components/notification-inbox";

export default async function AdminNotificationsPage() {
  const user = await requireAdmin();
  const items = await listNotificationsForUser({
    userId: user.id,
    role: user.role,
    limit: 150,
  });

  return <section className="shell py-10">
    <p className="font-bold text-[#3D75A7]">Platform administration</p>
    <h1 className="mt-2 text-4xl font-black">Notifications</h1>
    <p className="mt-3 max-w-3xl text-slate-400">
      Payment operations, customer lifecycle, privacy, security, and platform review items appear here.
    </p>
    <div className="mt-8">
      <NotificationInbox items={items} emptyMessage="No admin notifications require attention."/>
    </div>
  </section>;
}
