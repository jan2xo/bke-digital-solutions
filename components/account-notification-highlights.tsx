import Link from "next/link";
import type { WebNotificationItem } from "@/apps/web/notifications/center";

export function AccountNotificationHighlights({
  accountId,
  items,
}: {
  accountId: string;
  items: readonly WebNotificationItem[];
}) {
  // The principal-aware inbox already authorized visibility. Do not render another account's messages.
  const visible = items.filter((item) =>
    item.audienceKind === "ACCOUNT" && item.accountId === accountId,
  );
  const newest = visible.slice(0, 3);
  const unread = visible.filter((item) => item.state === "UNREAD").length;

  return (
    <section className="card mt-7 p-5 md:p-6" aria-label="Recent account notifications">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-sky-300">Account notifications</p>
          <h2 className="mt-1 text-xl font-black">Recent activity</h2>
          <p className="mt-1 text-sm text-slate-400">
            Confirmed payments, invoices, licensing, and account updates.
          </p>
        </div>
        <Link href="/dashboard/notifications" className="button secondary">View all notifications</Link>
      </div>
      {unread > 0 && <p className="mt-3 text-sm font-semibold text-sky-300" aria-live="polite">
        {unread} unread in recent activity
      </p>}
      {newest.length === 0
        ? <p className="mt-4 text-sm text-slate-400">No account notifications yet.</p>
        : <ul className="mt-4 grid gap-2">
            {newest.map((item) => (
              <li
                key={item.id}
                className={`rounded-lg border p-3 ${item.state === "UNREAD"
                  ? "border-sky-500/50 bg-sky-950/30"
                  : "border-slate-700 bg-slate-900/30"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-100">{item.title}</p>
                    <p className="mt-1 text-sm text-slate-300">{item.body}</p>
                  </div>
                  {item.state === "UNREAD" && <span className="text-xs font-bold text-sky-300">New</span>}
                </div>
              </li>
            ))}
          </ul>}
    </section>
  );
}
