import { requireRecentAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { publicTicketSelect } from "@/lib/support";

export default async function AdminSupportPage() {
  await requireRecentAdmin();
  const tickets = await db.supportTicket.findMany({ orderBy: [{ securityReport: "desc" }, { updatedAt: "desc" }], take: 200, select: publicTicketSelect(true) });
  return <main className="space-y-6"><div><h1 className="text-3xl font-semibold">Customer support</h1><p className="text-sm text-muted-foreground">Triage, assignment, secure security reports, private history, and account-safe context.</p></div><section className="grid gap-3">{tickets.map((ticket) => <article className="card" key={ticket.id}><div className="flex justify-between gap-4"><h2 className="font-semibold">{ticket.publicId}: {ticket.subject}</h2><span>{ticket.state} · {ticket.priority}</span></div><p className="text-sm">{ticket.category}{ticket.securityReport ? " · SECURITY REPORT" : ""}</p><pre className="mt-3 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(ticket.safeContext, null, 2)}</pre><details className="mt-3"><summary>Private history and messages</summary><ul className="mt-2 space-y-2">{ticket.messages.map((m) => <li key={m.id} className="text-sm"><b>{m.visibility}</b>: {m.body}</li>)}</ul><ul className="mt-2 text-xs text-muted-foreground">{ticket.events.map((e) => <li key={e.id}>{e.eventType}</li>)}</ul></details></article>)}</section></main>;
}
