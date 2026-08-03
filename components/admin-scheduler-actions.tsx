"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function AdminSchedulerActions({ jobKey, enabled, failedRunId }: { jobKey: string; enabled: boolean; failedRunId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  async function act(action: "RUN" | "DRY_RUN" | "PAUSE" | "RESUME" | "RETRY" | "ACKNOWLEDGE") {
    setBusy(action); setError(undefined);
    try {
      const response = await fetch("/api/admin/scheduler", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action === "RETRY" || action === "ACKNOWLEDGE" ? { action, runId: failedRunId } : { action, jobKey }) });
      if (!response.ok) throw new Error((await response.json()).error ?? "REQUEST_FAILED");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "REQUEST_FAILED"); }
    finally { setBusy(undefined); }
  }
  return <div className="flex flex-wrap gap-2">
    <button className="button px-3 py-2 text-sm" disabled={Boolean(busy)} onClick={() => act("RUN")}>Run now</button>
    <button className="button-secondary px-3 py-2 text-sm" disabled={Boolean(busy)} onClick={() => act("DRY_RUN")}>Dry run</button>
    <button className="button-secondary px-3 py-2 text-sm" disabled={Boolean(busy)} onClick={() => act(enabled ? "PAUSE" : "RESUME")}>{enabled ? "Pause" : "Resume"}</button>
    {failedRunId && <><button className="button-secondary px-3 py-2 text-sm" disabled={Boolean(busy)} onClick={() => act("RETRY")}>Retry failed</button><button className="button-secondary px-3 py-2 text-sm" disabled={Boolean(busy)} onClick={() => act("ACKNOWLEDGE")}>Acknowledge</button></>}
    {error && <span className="text-sm text-red-700">{error}</span>}
  </div>;
}
