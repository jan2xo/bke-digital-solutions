# Authorization matrix

| Capability | Member | License manager | Billing | Owner | Global admin |
|---|---:|---:|---:|---:|---:|
| View account catalog, orders, invoices | Yes | Yes | Yes | Yes | Operational view |
| View assigned licenses | Yes | Yes | Yes | Yes | Operational view |
| Assign users and manage activations | No | Yes | Yes | Yes | Yes, audited |
| Create checkout and renew | No | No | Yes | Yes | No impersonation |
| Invite or remove members | No | No | No | Yes | Yes, audited |
| Manage products and prices | No | No | No | No | Yes, audited |
| Suspend or revoke any license | No | No | No | No | Yes, audited |

Every resource query includes its account boundary. APIs return `404` where exposing resource existence would enable enumeration. The global admin role is checked server-side on every admin handler.
