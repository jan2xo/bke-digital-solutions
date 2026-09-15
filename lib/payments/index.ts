import "server-only";
import { env } from "@/platform/host/env";
import { MockPaymentProvider } from "./mock";
import { PayMongoProvider } from "./paymongo";

export const paymentProvider = env.PAYMENT_PROVIDER === "paymongo" ? new PayMongoProvider() : new MockPaymentProvider();
