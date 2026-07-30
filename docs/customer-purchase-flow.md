# Customer purchase flow

1. The customer registers, receives an expiring verification email, verifies the address, and signs in.
2. On a published product page, **Purchase securely** asks the server to recalculate the active price and create a pending order and provider checkout.
3. A browser return never marks the order paid. Only a verified payment webhook with matching mode, checkout, reference, amount, and currency can do so.
4. One database transaction confirms payment, finalizes the commercial invoice, issues the subscription/license, and queues receipt, invoice, and license-ready emails. The full license key is not emailed.
5. The dashboard shows orders, invoice links, subscriptions, license status, active-device usage, latest releases, and authorized download buttons.
6. A license key can be revealed once. Private downloads require current ownership and create an expiring, one-time grant; reused or forged grants return not found.
7. Activation enforces the license status, expiration, seat/device policy, and unique device identifier atomically. Customers can deactivate their own devices. Refunds revoke the license, cancel the subscription, void the invoice, and remove download/activation access.
