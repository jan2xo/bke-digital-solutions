"use client";

import { useRef, useState } from "react";

type PurchaseFor = "SELF" | "OTHER";

export function CheckoutStartButton({
  purchasePlanId,
  accounts,
  legalDocuments,
  allowRecipientPurchase,
}: {
  purchasePlanId: string;
  accounts: { id: string; name: string }[];
  legalDocuments: { versionId: string; type: string; title: string; slug: string }[];
  allowRecipientPurchase: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [offer, setOffer] = useState("");
  const [purchaseFor, setPurchaseFor] = useState<PurchaseFor>("SELF");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [accepted, setAccepted] = useState<string[]>([]);
  const [legalAttempted, setLegalAttempted] = useState(false);
  const legalPanel = useRef<HTMLFieldSetElement>(null);

  async function start() {
    if (accepted.length !== legalDocuments.length) {
      setLegalAttempted(true);
      setError("Please review and accept each required document before continuing.");
      legalPanel.current?.focus();
      return;
    }
    if (purchaseFor === "OTHER" && !recipientEmail.trim()) {
      setError("Enter the recipient's email address.");
      return;
    }

    setBusy(true);
    setError("");
    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purchasePlanId,
        customerAccountId: accountId,
        purchaseFor,
        ...(purchaseFor === "OTHER" ? { recipientEmail: recipientEmail.trim() } : {}),
        legalVersionIds: accepted,
        ...(offer.trim() ? { offerIdentifier: offer.trim() } : {}),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setError(({
        LEGAL_ACCEPTANCE_REQUIRED: "Accept every required legal document before checkout.",
        LEGAL_DOCUMENTS_UNAVAILABLE: "Checkout is unavailable until the required legal documents are published.",
        OFFER_NOT_FOUND: "This offer is unavailable for the selected account or plan.",
        OFFER_LIMIT_REACHED: "This offer has reached its redemption limit.",
        OFFER_ACCOUNT_LIMIT_REACHED: "This account has already used this offer.",
        RECIPIENT_PURCHASE_REQUIRES_PERPETUAL_PLAN: "Buying for someone else is currently available for perpetual licenses only.",
        CLAIM_UNIT_CONFLICT: "This recipient purchase conflicts with an existing claim. Review the recipient and try again.",
        CLAIM_UNITS_UNAVAILABLE: "Recipient license delivery is temporarily unavailable.",
        RATE_LIMITED: "Too many checkout attempts. Please wait before trying again.",
      } as Record<string, string>)[payload.error] ?? "Checkout could not be started");
      setBusy(false);
      return;
    }
    window.location.assign(payload.checkoutUrl);
  }

  return (
    <div className="mt-6 grid gap-4">
      <label className="label">
        Purchasing account
        <select className="input" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
          {accounts.map((account) => (
            <option value={account.id} key={account.id}>{account.name}</option>
          ))}
        </select>
      </label>

      <fieldset className="grid gap-2 rounded-xl border border-[#2d3850] p-4">
        <legend className="px-2 font-bold">Who is this license for?</legend>
        <label className="flex items-start gap-2">
          <input
            className="mt-1"
            type="radio"
            name="purchaseFor"
            value="SELF"
            checked={purchaseFor === "SELF"}
            onChange={() => {
              setPurchaseFor("SELF");
              setRecipientEmail("");
              setError("");
            }}
          />
          <span><b>For myself / my organization</b><span className="block text-sm text-[#a8b5c4]">The selected purchasing account receives the entitlement.</span></span>
        </label>
        {allowRecipientPurchase ? (
          <label className="flex items-start gap-2">
            <input
              className="mt-1"
              type="radio"
              name="purchaseFor"
              value="OTHER"
              checked={purchaseFor === "OTHER"}
              onChange={() => {
                setPurchaseFor("OTHER");
                setError("");
              }}
            />
            <span><b>For someone else</b><span className="block text-sm text-[#a8b5c4]">Payment stays with your purchasing account. The license is reserved for the recipient email after verification and is not granted to you first.</span></span>
          </label>
        ) : (
          <p className="text-sm text-[#a8b5c4]">Recipient purchases are currently available for perpetual licenses only.</p>
        )}
        {purchaseFor === "OTHER" && allowRecipientPurchase && (
          <label className="label mt-2">
            Recipient email
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={recipientEmail}
              onChange={(event) => setRecipientEmail(event.target.value)}
              maxLength={254}
              required
              placeholder="recipient@example.com"
            />
          </label>
        )}
      </fieldset>

      <label className="label">
        Offer code or identifier (optional)
        <input className="input" value={offer} onChange={(event) => setOffer(event.target.value)} maxLength={100} />
      </label>

      <fieldset
        ref={legalPanel}
        tabIndex={-1}
        className="legal-consent-panel grid gap-3 outline-none"
        data-invalid={legalAttempted || undefined}
        aria-describedby="checkout-legal-help"
      >
        <legend className="px-2 font-bold">Review and accept before continuing</legend>
        <p id="checkout-legal-help" className={`text-sm ${legalAttempted ? "font-semibold text-red-700" : "text-slate-600"}`}>
          {legalAttempted
            ? "Please review and accept each required document before continuing."
            : "Open each document, read it, then select every checkbox before secure payment."}
        </p>
        {legalDocuments.map((document) => (
          <label className="flex items-start gap-2 text-sm" key={document.versionId}>
            <input
              className="mt-1 size-4"
              type="checkbox"
              checked={accepted.includes(document.versionId)}
              onChange={(event) => {
                setAccepted((items) => event.target.checked
                  ? [...items, document.versionId]
                  : items.filter((id) => id !== document.versionId));
                setLegalAttempted(false);
                setError("");
              }}
            />
            <span>
              I have read and agree to the{" "}
              <a className="font-bold text-[#3D75A7] underline" href={`/legal/${document.slug}`} target="_blank" rel="noopener noreferrer">
                {document.title}
              </a>.
            </span>
          </label>
        ))}
      </fieldset>

      <button
        className="button"
        disabled={busy || !accountId || (purchaseFor === "OTHER" && !recipientEmail.trim())}
        data-incomplete={accepted.length !== legalDocuments.length || undefined}
        onClick={start}
      >
        {busy ? "Starting secure checkout…" : "Continue to secure payment"}
      </button>
      {error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}
    </div>
  );
}
