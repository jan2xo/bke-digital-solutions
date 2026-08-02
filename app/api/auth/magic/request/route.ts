import { NextResponse } from "next/server";
import { emailSchema } from "@/lib/validation";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { issueMagicLinkForExistingCustomer } from "@/lib/auth/magic-link";
export async function POST(request:Request){assertSameOrigin(request);const email=emailSchema.parse((await request.json()).email);if(!(await rateLimit(`magic:${clientIp(request)}:${email}`,5,3600)).allowed)return NextResponse.json({ok:true});await issueMagicLinkForExistingCustomer(email);return NextResponse.json({ok:true})}
