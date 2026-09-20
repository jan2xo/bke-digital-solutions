# Payment and entitlement flow

```text
Customer request
  -> server loads active prices and license policies
  -> pending order + immutable items + draft invoice + attempt
  -> provider hosted checkout
  -> customer returns (still pending)
  -> signed provider webhook
  -> event uniqueness + mode/reference/amount/currency checks
  -> serializable transaction
       payment PAID
       order PAID
       invoice FINAL
       subscription/license issued once
       audit/license event appended
```

Invalid events receive a client error. Transient processing failures receive a server error so the provider can retry. A stored failed event can be processed again only when its signed payload hash is unchanged. Unknown but correctly signed event types are recorded and acknowledged. Completed duplicate event IDs are acknowledged without repeating side effects.

Pending cancellation, replacement-checkout finalization, and verified settlement serialize on the order. A late provider-confirmed capture may move a locally cancelled order to paid; a later failure event cannot downgrade paid or refunded commerce.
