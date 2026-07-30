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

Invalid events receive a client error. Transient processing failures receive a server error so the provider can retry. Unknown but correctly signed event types are recorded and acknowledged. Duplicate event IDs are acknowledged without repeating side effects.
