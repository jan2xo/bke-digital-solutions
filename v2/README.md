# Digital Solutions V2

This directory is the clean-room engineering surface for Digital Solutions V2.

V1 remains preserved on `legacy/v1`. V2 does not inherit the global Prisma ownership model merely because V1 used it.

The first implementation gate is a disposable persistence isolation spike under `modules/spike-alpha` and `modules/spike-beta`.

The spike proves or disproves these requirements on fresh PostgreSQL only:

- each module owns its Prisma schema and migration intent;
- either module can migrate alone;
- independent modules can migrate in either order;
- a migration failure in one module does not make an unrelated module un-runnable;
- no production database is required or permitted for certification.

If Prisma's single physical migration ledger prevents those guarantees, the next implementation is a thin mechanical migration compositor. Business ownership remains inside the modules.
