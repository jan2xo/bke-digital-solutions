import { ObservabilityActions } from "@/components/observability-actions";
import { collectObservability, syncObservabilityAlerts } from "@/lib/observability/metrics";

const stateClass = (state: string) => state === "HEALTHY" ? "border-green-200 bg-green-50" : state === "WARNING" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50";

export default async function ObservabilityPage() {
  const snapshot = await collectObservability();
  const alerts = await syncObservabilityAlerts(snapshot);
  return <main className="shell py-10"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-bold uppercase text-primary">Operations</p><h1 className="text-4xl font-black">Platform health</h1><p className="mt-2 text-muted">A single view of application, dependencies, commerce, licensing, security, and recovery readiness.</p></div><span className={`rounded-full px-4 py-2 font-black ${stateClass(snapshot.overall)}`}>{snapshot.overall}</span></div>
    <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{snapshot.cards.map((card) => <article className={`card border p-5 ${stateClass(card.state)}`} key={card.key}><div className="flex items-start justify-between gap-3"><h2 className="text-xl font-black">{card.label}</h2><span className="text-xs font-black">{card.state}</span></div><p className="mt-2 text-sm text-muted">{card.summary}</p><dl className="mt-4 grid gap-2 text-sm">{card.metrics.map((item) => <div className="flex justify-between gap-3 border-t border-black/10 pt-2" key={item.key}><dt>{item.key}</dt><dd className="font-bold">{String(item.value ?? "—")}{item.unit ? ` ${item.unit}` : ""}</dd></div>)}</dl></article>)}</section>
    <section className="card mt-8 p-5"><h2 className="text-2xl font-black">Alerts</h2><p className="mt-1 text-sm text-muted">Internal alert history; external notification delivery is deferred.</p>{alerts.length === 0 ? <p className="mt-4 text-muted">No alerts recorded.</p> : <div className="mt-4 grid gap-3">{alerts.map((alert) => <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" key={alert.id}><div><p className="font-bold">{alert.title}</p><p className="text-sm text-muted">{alert.source} · {alert.severity} · {alert.status}</p></div><ObservabilityActions id={alert.id} status={alert.status}/></div>)}</div>}</section>
  </main>;
}
