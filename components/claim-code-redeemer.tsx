"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ClaimAccount = Readonly<{
  id: string;
  displayName: string;
  type: "INDIVIDUAL" | "ORGANIZATION";
  role: string;
}>;

export function ClaimCodeRedeemer({
  accounts,
}: {
  accounts: readonly ClaimAccount[];
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function redeem() {
    if (!code.trim() || !accountId) return;
    setBusy(true);
    setError("");

    const response = await fetch("/api/claims/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: code.trim(),
        customerAccountId: accountId,
      }),
    });
    const body = await response.json();

    if (!response.ok) {
      setError(({
        CLAIM_CODE_NOT_FOUND: "That Claim Code is invalid.",
        CLAIM_CODE_ALREADY_USED: "That Claim Code has already been redeemed.",
        CLAIM_CODE_REVOKED: "That Claim Code is no longer valid.",
        CLAIM_CODE_EXPIRED: "That Claim Code has expired.",
        ACCOUNT_ROLE_FORBIDDEN: "Your role cannot receive software into that account.",
        ACCOUNT_NOT_ACTIVE: "That account cannot currently receive software.",
        EMAIL_NOT_VERIFIED: "Verify your email before redeeming a Claim Code.",
      } as Record<string, string>)[body.error] ?? "The Claim Code could not be redeemed.");
      setBusy(false);
      return;
    }

    router.push(`/dashboard/accounts/${body.customerAccountId}`);
    router.refresh();
  }

  return <div className="card mt-8 grid gap-5 p-7">
    <label className="label">
      Claim Code
      <input
        className="input font-mono uppercase"
        value={code}
        onChange={(event) => {
          setCode(event.target.value.toUpperCase());
          setError("");
        }}
        placeholder="BKE-CLM-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
        autoComplete="off"
        spellCheck={false}
        maxLength={64}
      />
    </label>

    <label className="label">
      Add software to
      <select className="input" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
        {accounts.map((account) => <option key={account.id} value={account.id}>
          {account.displayName} · {account.type === "INDIVIDUAL" ? "Personal" : "Organization"} · {account.role}
        </option>)}
      </select>
    </label>

    <p className="text-sm text-[#a8b5c4]">
      Successful redemption permanently consumes the Claim Code and makes the selected account the software owner.
    </p>

    <button className="button" disabled={busy || !code.trim() || !accountId} onClick={redeem}>
      {busy ? "Redeeming…" : "Redeem Claim Code"}
    </button>

    {error && <p role="alert" className="text-sm font-bold text-red-500">{error}</p>}
  </div>;
}
