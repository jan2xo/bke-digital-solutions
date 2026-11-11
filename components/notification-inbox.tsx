import Link from "next/link";
import type { WebNotificationItem } from "@/apps/web/notifications/center";
import {
  dismissNotificationAction,
  markNotificationReadAction,
} from "@/apps/web/notifications/actions";

export function NotificationInbox({
  items,
  emptyMessage = "No notifications right now.",
  allowAccountNavigation = false,
}: {
  items: readonly WebNotificationItem[];
  emptyMessage?: string;
  allowAccountNavigation?: boolean;
}) {
  if (!items.length) {
    return <div className="card p-6 text-sm text-slate-400">{emptyMessage}</div>;
  }

  return <div className="grid gap-4">
    {items.map((item) => (
      <article
        className={`card p-5 ${item.state === "UNREAD" ? "ring-1 ring-sky-400/50" : ""}`}
        key={item.id}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wider text-sky-300">
              <span>{item.category}</span>
              <span>·</span>
              <span>{item.priority}</span>
              {item.accountName && <><span>·</span><span>{item.accountName}</span></>}
            </div>
            <h2 className="mt-2 text-xl font-black">{item.title}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{item.body}</p>
            <p className="mt-3 text-xs text-slate-500">
              {item.createdAt.toLocaleString("en-PH", { timeZone: "Asia/Manila" })} · {item.source}/{item.event}
            </p>
          </div>
          <span className={`admin-status ${item.state === "UNREAD" ? "admin-status-info" : "admin-status-neutral"}`}>
            {item.state}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {allowAccountNavigation && item.accountId && item.audienceKind === "ACCOUNT" && (
            <Link className="button" href={`/dashboard/accounts/${encodeURIComponent(item.accountId)}`}>
              Open account
            </Link>
          )}
          {item.state === "UNREAD" && (
            <form action={markNotificationReadAction}>
              <input type="hidden" name="notificationId" value={item.id}/>
              <button className="button secondary" type="submit">Mark read</button>
            </form>
          )}
          <form action={dismissNotificationAction}>
            <input type="hidden" name="notificationId" value={item.id}/>
            <button className="button secondary" type="submit">Dismiss</button>
          </form>
        </div>
      </article>
    ))}
  </div>;
}
