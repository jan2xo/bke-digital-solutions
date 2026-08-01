import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const recipient = process.env.RESEND_SANDBOX_TO;
if (!recipient) throw new Error("RESEND_SANDBOX_TO is required");
await db.emailOutbox.create({
  data: {
    type: "PAYMENT_RECEIPT",
    recipient,
    subject: "BKE Digital Solutions outbox certification",
    payload: { orderNumber: "LOCAL-CERTIFICATION" },
  },
});
console.info("Queued one certification outbox message.");
await db.$disconnect();
