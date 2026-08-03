# Customer account role capability matrix

| Capability | OWNER | BILLING | LICENSE_MANAGER | MEMBER |
| --- | --- | --- | --- | --- |
| View orders/invoices/payments | Yes | Yes | No | No |
| Purchase/renew/cancel pending order | Yes | Yes | No | No |
| View subscriptions | Yes | Yes | Yes | No |
| View/reveal/assign licenses | Yes | No | Yes | No broad access |
| Deactivate devices/download installers | Yes | No | Yes | Assigned download only |
| Start trial | Yes | Yes | No | No |
| Manage members/close account | Yes | No | No | No |

The server enforces capabilities in database predicates and service helpers; hidden controls are not authorization. A plain member may see only a license specifically assigned to that user and may download only through that assignment. Cross-account access fails as not found. `assertLastOwnerPreserved` protects the final owner when organization mutation UI is introduced in Phase 6.9.
