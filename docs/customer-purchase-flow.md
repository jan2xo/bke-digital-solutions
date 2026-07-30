# Customer purchase flow

1. The customer registers, receives an expiring verification email, verifies the address, and signs in.
2. On a published product page, the customer compares editions and chooses Perpetual, Monthly, or Annual. Annual savings and effective monthly cost are derived from the monthly plan.
3. The browser sends only `purchasePlanId`. The server reloads product/edition visibility, capabilities, limits, currency, amount, discount, interval, and renewal behavior before creating the pending order and provider checkout.
4. A browser return never marks the order paid. Only a verified payment webhook with matching mode, checkout, reference, amount, and currency can do so.
   While an order remains pending, the customer can continue the stored hosted checkout or cancel it. An older pending order without a stored URL creates a recorded replacement attempt; later continuation reuses that URL. If the provider confirms captured payment after local cancellation, the verified webhook completes the order and issues the entitlement exactly once.
5. One database transaction confirms payment, finalizes the commercial invoice, issues the edition/plan entitlement, and queues receipt, invoice, and license-ready emails. The full license key is not emailed.
6. The dashboard shows the purchased product, edition, plan, orders, invoice links, subscription dates, license status, active-device usage, latest releases, and authorized downloads.
7. An authorized customer can reveal the license key again from the secure portal; each reveal is audited. Private downloads still require current ownership and create an expiring, one-time grant; reused or forged grants return not found.
8. Activation atomically enforces status, expiration, and the edition's user/device limits, and returns only the active edition capabilities needed by the client. Customers can deactivate their own devices. Refunds revoke the license, cancel the subscription, void the invoice, and remove access.

Monthly and annual subscriptions do not auto-charge. Renewal creates a new customer-authorized hosted checkout using the subscription's stored purchase-plan link.

Verified customers may choose an authorized individual or organization account and start one seven-day trial per account and product each UTC calendar year, choosing a specific edition. Choosing another edition of the same product does not bypass the annual limit. Trial licenses use the normal ownership, activation, device-limit, expiration, and private-download checks. Administrators may grant additional trials, configure 0–14 grace days after day seven, reduce or remove grace, or revoke access. Revocation overrides all remaining trial/grace time, and redemption re-checks entitlement so an outstanding grant cannot outlive revocation or expiration.
