import { NextResponse } from "next/server";
import { readLimitedBody, clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { processPaymentWebhook } from "@/lib/webhooks";
import { PaymentLifecycleError, safePaymentError } from "@/lib/payments/errors";
export const runtime="nodejs";
export async function POST(request:Request){try{if(!(await rateLimit(`webhook:${clientIp(request)}`,240,60)).allowed)return NextResponse.json({error:"RATE_LIMITED"},{status:429});const raw=await readLimitedBody(request);const result=await processPaymentWebhook(raw,request.headers);return NextResponse.json(result)}catch(error){
  if(error instanceof Error&&error.message==="PAYLOAD_TOO_LARGE")return NextResponse.json({error:"PAYLOAD_TOO_LARGE"},{status:413});
  const code=safePaymentError(error);
  const status=code==="PAYMENT_EVENT_REPLAY_CONFLICT"?409:error instanceof PaymentLifecycleError&&error.retryable?503:400;
  return NextResponse.json({error:code},{status});
}}
