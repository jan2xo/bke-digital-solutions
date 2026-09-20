# Renewal reminders

Renewals remain customer-authorized checkout. The scheduler never stores a reusable payment method or initiates an unattended PayMongo charge.

Renewal reminders no longer send Resend email.

The scheduler continues to observe renewal eligibility for operations/health reporting, while customer-facing renewal communication is projected through the authenticated BKE account notification feed.

Current notification windows remain:

- monthly subscriptions: 7 days and 1 day before the current period ends
- annual subscriptions: 14 days, 7 days, and 1 day before the current period ends

Eligibility requires an active subscription, active customer account, verified and unsuspended owner, a customer-authorized purchase plan, and a future period end.

The account notification projection uses deterministic idempotency identity from the subscription ID, period end, and current reminder window. No automatic payment is attempted. Expiration remains authoritative whether or not an Agent is online to retrieve a notification.
