"use client";

import { FormEvent, useState } from "react";

export function AgentDeviceApprovalForm({
  userCode,
  accounts,
}: {
  userCode: string;
  accounts: readonly {
    id: string;
    type: "INDIVIDUAL" | "ORGANIZATION";
    displayName: string;
    effectiveRole: string;
  }[];
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [status, setStatus] = useState<"idle" | "busy" | "approved" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountId || status === "busy") return;
    setStatus("busy");
    setMessage("");

    const response = await fetch("/api/agent-sessions/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userCode, customerAccountId: accountId }),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus("error");
      setMessage(
        body.error === "DEVICE_AUTHORIZATION_EXPIRED"
          ? "This authorization request has expired. Start sign-in again from BKE Launcher or Licensing Agent."
          : body.error === "DEVICE_AUTHORIZATION_NOT_FOUND"
            ? "This device code is not valid."
            : "Unable to approve this device. Please try again.",
      );
      return;
    }

    setStatus("approved");
    setMessage(
      `Approved for ${body.account?.displayName ?? "the selected account"}. You can return to BKE Launcher.`,
    );
  }

  if (status === "approved") {
    return (
      <div className="card p-8">
        <h2 className="text-2xl font-black">Device approved</h2>
        <p className="mt-3 text-slate-600">{message}</p>
        <p className="mt-4 text-sm font-semibold text-slate-500">
          You may close this browser tab.
        </p>
      </div>
    );
  }

  return (
    <form className="card grid gap-5 p-8" onSubmit={submit}>
      <div>
        <p className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Device code
        </p>
        <p className="mt-1 font-mono text-xl font-black">{userCode}</p>
      </div>

      {accounts.length ? (
        <label className="label">
          Use BKE as
          <select
            className="input"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayName} · {account.type === "ORGANIZATION" ? "Organization" : "Personal"} · {account.effectiveRole}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          This BKE user does not have an active Personal or Organization account.
        </p>
      )}

      {message && (
        <p role="alert" className="text-sm font-semibold text-red-700">
          {message}
        </p>
      )}

      <button
        className="button"
        type="submit"
        disabled={!accountId || status === "busy"}
      >
        {status === "busy" ? "Approving…" : "Approve this device"}
      </button>
    </form>
  );
}
