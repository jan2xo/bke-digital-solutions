import { POST as processCanonicalPaymentWebhook } from "@/app/api/webhooks/payments/route";

export const runtime = "nodejs";
export const POST = processCanonicalPaymentWebhook;
