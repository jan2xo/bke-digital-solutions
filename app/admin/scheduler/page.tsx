import { AdminSchedulerActions } from "@/components/admin-scheduler-actions";
import { schedulerHealth } from "@/lib/scheduler/health";

const when = (value: Date | null) => value ? value.toLocaleString() : "Never";
export default async function SchedulerPage() {
  const health = await schedulerHealth();
  return <main className="shell py-10">
    <h1 className="text-4xl font-black">Scheduler</h1>
    <p className="mt-2 text-muted">Durable lifecycle automation is <strong>{health.status}</strong>. Scheduled work never auto-charges, auto-refunds, auto-settles, or purges customer data.</p>
    <section className="mt-8 grid gap-5">
      {health.jobs.map((job) => {
        const failed = job.recentRuns.find((run) => ["FAILED", "ABANDONED"].includes(run.status) && !run.acknowledgedAt);
        return <article className="card p-5" key={job.key}>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-bold uppercase text-primary">{job.category} · {job.health}</p><h2 className="text-xl font-black">{job.name}</h2><p className="text-sm text-muted">{job.description}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold">{job.enabled ? "Enabled" : "Paused"}</span></div>
          <dl className="my-4 grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6"><div><dt>Cadence</dt><dd>{job.cadenceSeconds}s</dd></div><div><dt>Next run</dt><dd>{when(job.nextRunAt)}</dd></div><div><dt>Last run</dt><dd>{when(job.lastRunAt)}</dd></div><div><dt>Last success</dt><dd>{when(job.lastSuccessAt)}</dd></div><div><dt>Failures</dt><dd>{job.consecutiveFailures}</dd></div><div><dt>Average</dt><dd>{job.averageDurationMs == null ? "—" : `${job.averageDurationMs} ms`}</dd></div></dl>
          <AdminSchedulerActions jobKey={job.key} enabled={job.enabled} failedRunId={failed?.id}/>
          {job.recentRuns.length > 0 && <details className="mt-4"><summary className="cursor-pointer font-bold">Recent history</summary><div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th>Started</th><th>Status</th><th>Trigger</th><th>Attempt</th><th>Duration</th><th>Error</th></tr></thead><tbody>{job.recentRuns.map((run) => <tr className="border-t" key={run.id}><td>{when(run.startedAt)}</td><td>{run.status}</td><td>{run.trigger}{run.dryRun ? " (dry)" : ""}</td><td>{run.attempt}</td><td>{run.durationMs == null ? "—" : `${run.durationMs} ms`}</td><td>{run.errorCode ?? "—"}</td></tr>)}</tbody></table></div></details>}
        </article>;
      })}
    </section>
  </main>;
}
