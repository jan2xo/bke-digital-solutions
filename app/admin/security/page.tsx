import { AdminSecurityActions } from "@/components/admin-security-actions";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function AdminSecurityPage() {
  const user = await requireAdmin();
  const [codes, events, sessions] = await Promise.all([
    db.administratorRecoveryCode.count({ where: { userId: user.id, usedAt: null } }),
    db.securityEvent.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.session.findMany({ where: { userId: user.id }, orderBy: { lastSeenAt: "desc" }, select: { id: true, createdAt: true, lastSeenAt: true, absoluteExpiresAt: true, userAgent: true } }),
  ]);
  return <main className="mx-auto max-w-5xl px-4 py-10"><h1 className="text-4xl font-black">Administrator security</h1><div className="card mt-6 p-6"><p><strong>Authenticator MFA:</strong> enabled</p><p><strong>Unused recovery codes:</strong> {codes}</p><p><strong>Active sessions:</strong> {sessions.length}</p><p className="mt-3 text-sm text-slate-600">Sensitive changes require your password and authenticator or recovery code again. The confirmation lasts 15 minutes.</p></div><div className="mt-6"><AdminSecurityActions/></div><h2 className="mt-8 text-2xl font-bold">Active session summary</h2><div className="card mt-3 grid gap-3 p-4">{sessions.map((session) => <div key={session.id} className="border-b pb-3"><strong>Last active:</strong> {session.lastSeenAt.toLocaleString()}<br/><span className="text-sm text-slate-600">Expires {session.absoluteExpiresAt.toLocaleString()} · {session.userAgent?.slice(0, 100) ?? "Unknown client"}</span></div>)}</div><h2 className="mt-8 text-2xl font-bold">Recent security events</h2><div className="card mt-3 overflow-auto"><table className="w-full text-left"><thead><tr><th className="p-3">Time</th><th className="p-3">Event</th><th className="p-3">Network hint</th></tr></thead><tbody>{events.map((event) => <tr key={event.id} className="border-t"><td className="p-3">{event.createdAt.toLocaleString()}</td><td className="p-3">{event.type}</td><td className="p-3 font-mono">{event.ipHint}</td></tr>)}</tbody></table></div></main>;
}
