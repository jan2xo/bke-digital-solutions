# Renewal reminders

Renewals remain customer-authorized checkout. The scheduler never stores a reusable payment method or initiates an unattended PayMongo charge.

Monthly subscriptions receive reminders seven and one day before the current period ends. Annual subscriptions receive reminders fourteen, seven, and one day before expiration. Eligibility requires an active subscription, active customer account, verified and unsuspended owner, a customer-authorized purchase plan, and a future period end.

The outbox key includes subscription ID, period end, and reminder window, so repeated or concurrent runs create one message. The link is built from `APP_URL` and starts the existing authenticated renewal flow. Retry is handled by the outbox. Expiration remains authoritative even if a reminder cannot be delivered.
