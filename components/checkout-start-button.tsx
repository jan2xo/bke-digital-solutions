"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { parseCheckoutQrImage } from "./checkout-qr-image";

type CheckoutAccount = Readonly<{ id: string; name: string }>;
type LegalDocument = Readonly<{ versionId: string; type: string; title: string; slug: string }>;
type PaymentIntentUi = Readonly<{ status: string; amountMinor: number; currency: string; qrImageUrl?: string; expiresAt?: string }>;
type PaymentStatus = "PENDING" | "PAID" | "CANCELLED" | "REFUNDED";
type StoredCheckoutState = Readonly<{
  version: 1;
  email: string;
  purchasePlanId: string;
  customerAccountId: string;
  purchaseFor: "SELF" | "GIFT";
  offer: string;
  paymentIntentNonce: string;
  locked: boolean;
  uncertain: boolean;
  orderId?: string;
  accepted?: string[];
}>;

function storageKey(email: string, purchasePlanId: string, customerAccountId: string): string {
  // Keep the key opaque while scoping saved state to the signed-in email and plan.
  let hash = 2166136261;
  for (const character of email.trim().toLowerCase() + "\0" + purchasePlanId + "\0" + customerAccountId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return "bke.checkout.payment-intent.v1:" + (hash >>> 0).toString(16);
}

function isRecord(value: unknown): value is StoredCheckoutState {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredCheckoutState>;
  return record.version === 1 &&
    typeof record.email === "string" &&
    typeof record.purchasePlanId === "string" &&
    typeof record.customerAccountId === "string" &&
    (record.purchaseFor === "SELF" || record.purchaseFor === "GIFT") &&
    typeof record.offer === "string" &&
    typeof record.paymentIntentNonce === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.paymentIntentNonce) &&
    typeof record.locked === "boolean" &&
    typeof record.uncertain === "boolean" &&
    (record.accepted === undefined || (Array.isArray(record.accepted) && record.accepted.every((item) => typeof item === "string"))) &&
    (record.orderId === undefined || (typeof record.orderId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(record.orderId)));
}


function formatMinorAmount(amountMinor: number, currency: string): string {
  const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(amountMinor / (10 ** fractionDigits));
}

function errorMessage(code: unknown): string {
  const messages: Record<string, string> = {
    LEGAL_ACCEPTANCE_REQUIRED: "Accept every required legal document before checkout.",
    LEGAL_REACCEPTANCE_REQUIRED: "Review and accept the current legal documents before continuing.",
    LEGAL_DOCUMENTS_UNAVAILABLE: "Checkout is unavailable until the required legal documents are published.",
    INVALID_CHECKOUT: "Check the checkout details and try again.",
    INVALID_PURCHASE_PLAN: "This purchase plan is unavailable.",
    INVALID_CATALOG_EDITION: "This edition is unavailable.",
    INVALID_CATALOG_PRODUCT: "This product is unavailable.",
    OFFER_NOT_FOUND: "This offer is unavailable for the selected account or plan.",
    OFFER_LIMIT_REACHED: "This offer has reached its redemption limit.",
    OFFER_ACCOUNT_LIMIT_REACHED: "This account has already used this offer.",
    CLAIM_UNIT_CONFLICT: "This gift purchase conflicts with an existing claim. Please contact support.",
    CLAIM_UNITS_UNAVAILABLE: "Gift fulfillment is temporarily unavailable. No software right was assigned to the paying account.",
    GIFT_CHECKOUT_DISABLED: "Gift Claim Code purchases are not enabled in this environment.",
    RATE_LIMITED: "Too many checkout attempts. Please wait before trying again.",
    PAYMENT_INTENT_IN_PROGRESS: "Payment setup is still being confirmed. Keep this checkout open and retry the same checkout.",
    PAYMENT_INTENT_RECOVERY_REQUIRED: "Checkout needs support review; do not start another payment. Keep this checkout reference.",
    PAYMENT_REQUEST_IN_PROGRESS: "Payment setup is still being confirmed. Keep this checkout open and retry the same checkout.",
    PAYMENT_RECOVERY_REQUIRED: "Checkout needs support review; do not start another payment. Keep this checkout reference.",
    CHECKOUT_REQUEST_MISMATCH: "This checkout request no longer matches the pending order. Resume the original checkout or contact support.",
  };
  return messages[String(code)] ?? "Checkout could not be confirmed. Keep this checkout open and retry the same checkout.";
}

const KNOWN_PRE_CREATION_ERRORS = new Set([
  "EMAIL_NOT_VERIFIED",
  "FORBIDDEN",
  "ACCOUNT_UNAVAILABLE",
  "INVALID_CHECKOUT",
  "INVALID_PURCHASE_PLAN",
  "INVALID_CATALOG_EDITION",
  "INVALID_CATALOG_PRODUCT",
  "GIFT_CHECKOUT_DISABLED",
  "LEGAL_ACCEPTANCE_REQUIRED",
  "LEGAL_REACCEPTANCE_REQUIRED",
  "LEGAL_DOCUMENTS_UNAVAILABLE",
  "RATE_LIMITED",
]);

type CheckoutStartButtonProps = {
  purchasePlanId: string;
  currentEmail: string;
  giftCheckoutEnabled: boolean;
  paymentIntentEnabled: boolean;
  accounts: CheckoutAccount[];
  legalDocuments: LegalDocument[];
};

// React reads the server snapshot during hydration, so no localStorage state is
// consumed until after hydration. This avoids both markup mismatches and effect
// setters that could erase an interrupted Payment Intent checkout.
const subscribeToHydration = () => () => {};
const clientHydrationSnapshot = () => true;
const serverHydrationSnapshot = () => false;

export function CheckoutStartButton(props: CheckoutStartButtonProps) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration, clientHydrationSnapshot, serverHydrationSnapshot,
  );
  if (props.paymentIntentEnabled && !hydrated) {
    return <p className="mt-6 text-sm text-slate-400" role="status">Restoring your secure checkout…</p>;
  }
  return <CheckoutStartButtonClient
    key={props.currentEmail.trim().toLowerCase() + "\0" + props.purchasePlanId}
    {...props}
  />;
}

type RestoredCheckout = Readonly<{ accountId: string; record: StoredCheckoutState }>;

function readPendingCheckout(
  currentEmail: string, purchasePlanId: string, accounts: readonly CheckoutAccount[],
): RestoredCheckout | null {
  try {
    for (const account of accounts) {
      const raw = window.localStorage.getItem(storageKey(currentEmail, purchasePlanId, account.id));
      if (!raw) continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (isRecord(parsed) &&
          parsed.email === currentEmail &&
          parsed.purchasePlanId === purchasePlanId &&
          parsed.customerAccountId === account.id &&
          (parsed.locked || parsed.uncertain || Boolean(parsed.orderId))) {
          return { accountId: account.id, record: parsed };
        }
      } catch {
        // A malformed record cannot authorize or replace a valid pending order.
      }
    }
  } catch {
    // Storage failures never result in an untracked provider request: persist()
    // must still succeed before starting the checkout API call.
  }
  return null;
}

function CheckoutStartButtonClient({
  purchasePlanId, currentEmail, giftCheckoutEnabled,
  paymentIntentEnabled, accounts, legalDocuments,
}: CheckoutStartButtonProps) {
  const [pending] = useState(() =>
    paymentIntentEnabled ? readPendingCheckout(currentEmail, purchasePlanId, accounts) : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accountId, setAccountId] = useState(pending?.accountId ?? accounts[0]?.id ?? "");
  const [offer, setOffer] = useState(pending?.record.offer ?? "");
  const [purchaseFor, setPurchaseFor] = useState<"SELF" | "GIFT">(pending?.record.purchaseFor ?? "SELF");
  const [accepted, setAccepted] = useState<string[]>(() =>
    (pending?.record.accepted ?? []).filter((item) =>
      legalDocuments.some((document) => document.versionId === item)),
  );
  const [legalAttempted, setLegalAttempted] = useState(false);
  const restored = true;
  const [locked, setLocked] = useState(Boolean(pending));
  const [uncertain, setUncertain] = useState(pending?.record.uncertain ?? false);
  const [nonce, setNonce] = useState(pending?.record.paymentIntentNonce ?? "");
  const [orderId, setOrderId] = useState(pending?.record.orderId ?? "");
  const [orderNumber, setOrderNumber] = useState("");
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntentUi | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | undefined>();
  const [pollingExpired, setPollingExpired] = useState(false);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const legalPanel = useRef<HTMLFieldSetElement>(null);
  const storage = storageKey(currentEmail, purchasePlanId, accountId);
  const pollStartedAt = useRef<number | null>(pending?.record.orderId ? Date.now() : null);
  const checkoutRequestGeneration = useRef(0);
  const checkoutTerminal = useRef(false);
  const activeCheckoutRequest = useRef<AbortController | null>(null);

  useEffect(() => () => {
    checkoutRequestGeneration.current += 1;
    activeCheckoutRequest.current?.abort();
  }, []);

  const persist = useCallback((next: StoredCheckoutState, acceptedVersions: string[]): boolean => {
    try {
      const existingRaw = window.localStorage.getItem(storage);
      if (existingRaw !== null) {
        const existingValue: unknown = JSON.parse(existingRaw);
        if (!isRecord(existingValue)) return false;
        const otherPendingNonce = existingValue.paymentIntentNonce !== next.paymentIntentNonce &&
          (existingValue.locked || existingValue.uncertain || Boolean(existingValue.orderId));
        if (otherPendingNonce) return false;
      }
      window.localStorage.setItem(storage, JSON.stringify({ ...next, accepted: acceptedVersions }));
      return true;
    } catch {
      return false;
    }
  }, [storage]);

  const removeOwnedSavedCheckout = useCallback((expectedNonce: string) => {
    if (!expectedNonce) return;
    try {
      const raw = window.localStorage.getItem(storage);
      if (raw === null) return;
      const value: unknown = JSON.parse(raw);
      if (isRecord(value) && value.paymentIntentNonce === expectedNonce) {
        window.localStorage.removeItem(storage);
      }
    } catch {
      // An unreadable storage record is preserved rather than deleting an unknown checkout.
    }
  }, [storage]);

  const clearSavedCheckout = useCallback((expectedNonce = nonce) => {
    removeOwnedSavedCheckout(expectedNonce);
    setNonce("");
    setOrderId("");
    setOrderNumber("");
    setPaymentIntent(null);
    setPaymentStatus(undefined);
    setPollingExpired(false);
    setRecoveryRequired(false);
    setLocked(false);
    setUncertain(false);
    pollStartedAt.current = null;
  }, [nonce, removeOwnedSavedCheckout]);

  useEffect(() => {
    if (!paymentIntentEnabled || checkoutTerminal.current || !orderId || !locked || paymentStatus === "PAID" || paymentStatus === "CANCELLED" || paymentStatus === "REFUNDED") {
      return;
    }

    const startedAt = pollStartedAt.current ?? Date.now();
    pollStartedAt.current = startedAt;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeController: AbortController | undefined;

    const poll = async () => {
      if (stopped) return;
      if (Date.now() - startedAt >= 15 * 60 * 1000) {
        setPollingExpired(true);
        return;
      }

      activeController = new AbortController();
      try {
        const response = await fetch("/api/checkout/payment-intent-status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          signal: activeController.signal,
          body: JSON.stringify({ orderId, customerAccountId: accountId }),
        });
        const payload: unknown = await response.json();
        if (!response.ok || !payload || typeof payload !== "object") {
          throw new Error("CHECKOUT_STATUS_UNAVAILABLE");
        }
        const status = (payload as { status?: unknown }).status;
        if (status !== "PENDING" && status !== "PAID" && status !== "CANCELLED" && status !== "REFUNDED") {
          throw new Error("CHECKOUT_STATUS_UNAVAILABLE");
        }
        if (stopped || checkoutTerminal.current) return;
        if (status === "PAID" || status === "CANCELLED" || status === "REFUNDED") {
          checkoutTerminal.current = true;
          checkoutRequestGeneration.current += 1;
          activeCheckoutRequest.current?.abort();
          setBusy(false);
          setRecoveryRequired(false);
        }
        if (status === "PAID") {
          clearSavedCheckout(nonce);
          window.location.assign("/checkout/success?orderId=" + encodeURIComponent(orderId));
          return;
        }
        if (status === "CANCELLED" || status === "REFUNDED") {
          setPaymentStatus(status);
          return;
        }
        setPaymentStatus(status);
        persist({
          version: 1,
          email: currentEmail,
          purchasePlanId,
          customerAccountId: accountId,
          purchaseFor,
          offer,
          paymentIntentNonce: nonce,
          locked: true,
          uncertain: false,
          orderId,
        }, accepted);
      } catch {
        if (!stopped && !checkoutTerminal.current) {
          setError("Payment status is temporarily unavailable. This checkout is still open; retry it with the same checkout.");
        }
      } finally {
        if (!stopped && !checkoutTerminal.current) timer = setTimeout(() => void poll(), 5000);
      }
    };

    timer = setTimeout(() => void poll(), 5000);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      activeController?.abort();
    };
  }, [paymentIntentEnabled, orderId, locked, paymentStatus, accountId, currentEmail, purchasePlanId, purchaseFor, offer, nonce, accepted, persist, clearSavedCheckout]);

  function saveCurrent(nextNonce: string, nextLocked: boolean, nextUncertain: boolean, nextOrderId = orderId): boolean {
    return persist({
      version: 1,
      email: currentEmail,
      purchasePlanId,
      customerAccountId: accountId,
      purchaseFor,
      offer,
      paymentIntentNonce: nextNonce,
      locked: nextLocked,
      uncertain: nextUncertain,
      ...(nextOrderId ? { orderId: nextOrderId } : {}),
    }, accepted);
  }

  async function start() {
    if (checkoutTerminal.current) return;
    if (!giftCheckoutEnabled && purchaseFor === "GIFT") {
      setPurchaseFor("SELF");
      setError("Gift purchases are not enabled in this environment.");
      return;
    }
    if (accepted.length !== legalDocuments.length) {
      setLegalAttempted(true);
      setError("Please review and accept each required document before continuing.");
      legalPanel.current?.focus();
      return;
    }

    let requestNonce = paymentIntentEnabled ? nonce : "";
    if (paymentIntentEnabled && !requestNonce) {
      if (!globalThis.crypto?.randomUUID) {
        setError("Secure checkout cannot start in this browser. Please use a current browser over HTTPS.");
        return;
      }
      requestNonce = globalThis.crypto.randomUUID();
      setNonce(requestNonce);
    }

    const hadUncertainOutcome = uncertain;
    setBusy(true);
    setError("");
    if (paymentIntentEnabled) {
      setLocked(true);
      setUncertain(true);
      if (!saveCurrent(requestNonce, true, true)) {
        setLocked(false);
        setUncertain(false);
        setBusy(false);
        setError("Secure checkout needs browser storage to preserve safe retries. Enable site storage and try again.");
        return;
      }
    }
    const requestGeneration = ++checkoutRequestGeneration.current;
    const requestController = new AbortController();
    activeCheckoutRequest.current = requestController;
    const isCurrentRequest = () =>
      checkoutRequestGeneration.current === requestGeneration && !checkoutTerminal.current;
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        signal: requestController.signal,
        body: JSON.stringify({
          purchasePlanId,
          customerAccountId: accountId,
          purchaseFor,
          legalVersionIds: accepted,
          ...(paymentIntentEnabled ? { paymentIntentNonce: requestNonce } : {}),
          ...(offer.trim() ? { offerIdentifier: offer.trim() } : {}),
        }),
      });
      if (!isCurrentRequest()) return;
      let payload: Record<string, unknown>;
      try {
        const parsed: unknown = await response.json();
        if (!parsed || typeof parsed !== "object") throw new Error("INVALID_RESPONSE");
        payload = parsed as Record<string, unknown>;
      } catch {
        throw new Error("CHECKOUT_OUTCOME_UNKNOWN");
      }
      if (!isCurrentRequest()) return;

      if (!response.ok) {
        const code = typeof payload.error === "string" ? payload.error : "CHECKOUT_FAILED";
        const responseOrderId = typeof payload.orderId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(payload.orderId)
          ? payload.orderId
          : undefined;
        const hasExistingOrder = Boolean(responseOrderId || orderId);
        setError(errorMessage(code));
        setRecoveryRequired(code === "PAYMENT_RECOVERY_REQUIRED" || code === "PAYMENT_INTENT_RECOVERY_REQUIRED");
        if (responseOrderId) setOrderId(responseOrderId);
        if (paymentIntentEnabled && !hadUncertainOutcome && !hasExistingOrder && response.status >= 400 && response.status < 500 && KNOWN_PRE_CREATION_ERRORS.has(code)) {
          setLocked(false);
          setUncertain(false);
          removeOwnedSavedCheckout(requestNonce);
        } else if (paymentIntentEnabled) {
          setLocked(true);
          setUncertain(true);
          saveCurrent(requestNonce, true, true, responseOrderId ?? orderId);
        }
        setBusy(false);
        return;
      }

      if (typeof payload.checkoutUrl === "string") {
        const destination = new URL(payload.checkoutUrl, window.location.origin);
        const ownOrigin = destination.origin === window.location.origin;
        const payMongoHosted = destination.protocol === "https:" && destination.hostname === "checkout.paymongo.com";
        if (!ownOrigin && !payMongoHosted) throw new Error("INVALID_CHECKOUT_DESTINATION");
        if (payload.complimentary === true || payload.paymentConfirmed === true) {
          checkoutTerminal.current = true;
          checkoutRequestGeneration.current += 1;
          activeCheckoutRequest.current?.abort();
          setBusy(false);
          clearSavedCheckout(requestNonce);
          window.location.assign(destination.toString());
          return;
        }
        if (paymentIntentEnabled && typeof payload.orderId === "string") {
          setOrderId(payload.orderId);
          setUncertain(false);
          saveCurrent(requestNonce, true, false, payload.orderId);
        }
        window.location.assign(destination.toString());
        return;
      }

      if (!paymentIntentEnabled || typeof payload.orderId !== "string" || !payload.paymentIntent || typeof payload.paymentIntent !== "object") {
        throw new Error("CHECKOUT_OUTCOME_UNKNOWN");
      }
      const intent = payload.paymentIntent as Record<string, unknown>;
      const amountMinor = intent.amountMinor;
      const currency = intent.currency;
      if (!Number.isSafeInteger(amountMinor) || (amountMinor as number) < 0 || typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
        throw new Error("INVALID_PAYMENT_AMOUNT");
      }
      try {
        new Intl.NumberFormat(undefined, { style: "currency", currency });
      } catch {
        throw new Error("INVALID_PAYMENT_CURRENCY");
      }
      const qrImageUrl = parseCheckoutQrImage(intent.qrImageUrl);
      const safeIntent: PaymentIntentUi = {
        status: typeof intent.status === "string" ? intent.status : "unknown",
        amountMinor: amountMinor as number,
        currency,
        ...(qrImageUrl ? { qrImageUrl } : {}),
        ...(typeof intent.expiresAt === "string" && Number.isFinite(Date.parse(intent.expiresAt))
          ? { expiresAt: intent.expiresAt }
          : {}),
      };
      setOrderId(payload.orderId);
      setUncertain(false);
      setRecoveryRequired(false);
      setPaymentIntent(safeIntent);
      setPaymentStatus("PENDING");
      setPollingExpired(false);
      pollStartedAt.current = Date.now();
      saveCurrent(requestNonce, true, false, payload.orderId);
      setBusy(false);
    } catch {
      if (!isCurrentRequest()) return;
      setError("The checkout response was interrupted. Its result may still be processing; retry this same checkout.");
      if (paymentIntentEnabled) {
        setLocked(true);
        setUncertain(true);
        saveCurrent(requestNonce, true, true);
      }
      setBusy(false);
    } finally {
      if (activeCheckoutRequest.current === requestController) activeCheckoutRequest.current = null;
      if (isCurrentRequest()) setBusy(false);
    }
  }

  function startAnotherCheckout() {
    checkoutTerminal.current = false;
    checkoutRequestGeneration.current += 1;
    activeCheckoutRequest.current?.abort();
    clearSavedCheckout(nonce);
    setError("");
  }

  const terminalStatus = paymentStatus === "CANCELLED" || paymentStatus === "REFUNDED";
  const providerSucceeded = paymentIntent?.status === "succeeded" || paymentIntent?.status === "confirming";
  const lockedFields = paymentIntentEnabled && locked;

  return <div className="mt-6 grid gap-4">
    <label className="label">
      Paying account
      <select className="input" value={accountId} disabled={lockedFields || !restored} onChange={(event) => setAccountId(event.target.value)}>
        {accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}
      </select>
    </label>

    <fieldset className="grid gap-2" disabled={lockedFields}>
      <legend className="font-bold">How should this purchase be delivered?</legend>
      <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="purchase-for" checked={purchaseFor === "SELF"} onChange={() => { setPurchaseFor("SELF"); setError(""); }} />
        <span>For my account <span className="text-[#8790ae]">({currentEmail})</span></span>
      </label>
      {giftCheckoutEnabled && <label className="flex items-center gap-2 text-sm">
        <input type="radio" name="purchase-for" checked={purchaseFor === "GIFT"} onChange={() => { setPurchaseFor("GIFT"); setError(""); }} />
        <span>Buy as gift / Claim Code</span>
      </label>}
      {giftCheckoutEnabled && purchaseFor === "GIFT" && <p className="rounded-lg border border-[#2d3850] bg-[#151d29] p-3 text-sm text-[#a8b5c4]">
        After payment, your account receives a one-time Claim Code. Send that code to anyone you choose. The first eligible BKE account that successfully redeems it becomes the software owner.
      </p>}
    </fieldset>

    <label className="label">
      Offer code or identifier (optional)
      <input className="input" value={offer} disabled={lockedFields} onChange={(event) => setOffer(event.target.value)} maxLength={100} />
    </label>

    <fieldset ref={legalPanel} tabIndex={-1} className="legal-consent-panel grid gap-3 outline-none" data-invalid={legalAttempted || undefined} aria-describedby="checkout-legal-help">
      <legend className="px-2 font-bold">Review and accept before continuing</legend>
      <p id="checkout-legal-help" className={"text-sm " + (legalAttempted ? "font-semibold text-red-700" : "text-slate-600")}>
        {legalAttempted ? "Please review and accept each required legal document before continuing." : "Open each document, read it, then select every checkbox before secure payment."}
      </p>
      {legalDocuments.map((document) => <label className="flex items-start gap-2 text-sm" key={document.versionId}>
        <input className="mt-1 size-4" type="checkbox" checked={accepted.includes(document.versionId)} onChange={(event) => {
          setAccepted((items) => event.target.checked ? [...items, document.versionId] : items.filter((id) => id !== document.versionId));
          setLegalAttempted(false);
          setError("");
        }} />
        <span>I have read and agree to the <a className="font-bold text-[#3D75A7] underline" href={"/legal/" + document.slug} target="_blank" rel="noopener noreferrer">{document.title}</a>.</span>
      </label>)}
    </fieldset>

    {paymentIntentEnabled && orderId && <section className="rounded-xl border border-[#2d3850] bg-[#151d29] p-4" aria-live="polite">
      <h2 className="font-bold text-white">Secure QR payment</h2>
      {paymentIntent && <p className="mt-2 text-lg font-bold text-white">Amount due: {formatMinorAmount(paymentIntent.amountMinor, paymentIntent.currency)}</p>}
      <p className="text-sm text-[#a8b5c4]">Order reference: {orderNumber || orderId}</p>
      {paymentIntent?.qrImageUrl
        ? <img className="mx-auto my-4 max-w-64 rounded bg-white p-2" src={paymentIntent.qrImageUrl} alt="QR payment code" referrerPolicy="no-referrer" />
        : paymentIntent
          ? <p className="mt-3 text-sm text-[#a8b5c4]">Payment instructions are being prepared. Retry this same checkout if they do not appear.</p>
          : <p className="mt-3 text-sm text-[#a8b5c4]">This checkout is still open. Select “Retry the same checkout” to refresh its payment instructions.</p>}
      {paymentIntent?.expiresAt && <p className="text-sm text-[#a8b5c4]">Expires {new Date(paymentIntent.expiresAt).toLocaleString()}.</p>}
      <p className="mt-2 text-sm text-[#a8b5c4]">
        {paymentStatus === "PAID"
          ? "Payment confirmed."
          : terminalStatus
            ? "This checkout is " + paymentStatus?.toLowerCase() + ". Start a new checkout only if you intend to make another purchase."
            : providerSucceeded
              ? "The provider reports success. Confirming your payment with the order record…"
              : "Waiting for the order record to confirm payment…"}
      </p>
      {pollingExpired && !terminalStatus && paymentStatus !== "PAID" && <p className="mt-2 text-sm text-[#a8b5c4]">Automatic status checks paused. Retry this same checkout to continue.</p>}
    </section>}

    <button className="button" disabled={busy || !accountId || (paymentIntentEnabled && !restored) || terminalStatus || recoveryRequired} data-incomplete={accepted.length !== legalDocuments.length || undefined} onClick={() => void start()}>
      {busy ? "Starting secure checkout…" : orderId || locked ? "Retry the same checkout" : "Continue to secure payment"}
    </button>
    {terminalStatus && <button className="button" onClick={startAnotherCheckout}>Start another checkout</button>}
    {error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}
  </div>;
}
