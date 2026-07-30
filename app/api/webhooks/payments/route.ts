import { NextResponse } from "next/server";
import { readLimitedBody, clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { processPaymentWebhook } from "@/lib/webhooks";
export const runtime="nodejs";
export async function POST(request:Request){try{if(!(await rateLimit(`webhook:${clientIp(request)}`,240,60)).allowed)return NextResponse.json({error:"RATE_LIMITED"},{status:429});const raw=await readLimitedBody(request);const result=await processPaymentWebhook(raw,request.headers);return NextResponse.json(result)}catch(error){const invalid=error instanceof Error&&["INVALID_SIGNATURE","MODE_MISMATCH","PAYLOAD_TOO_LARGE"].includes(error.message);return NextResponse.json({error:invalid?error.message:"PROCESSING_FAILED"},{status:invalid?400:500})}}
