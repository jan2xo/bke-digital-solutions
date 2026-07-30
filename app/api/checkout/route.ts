import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createCheckout } from "@/lib/checkout";
import { checkoutSchema } from "@/lib/validation";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { rateLimit } from "@/lib/security/rate-limit";
import { apiError } from "@/lib/http";
export async function POST(request:Request){try{assertSameOrigin(request);const user=await requireUser();if(!user.emailVerified)return NextResponse.json({error:"EMAIL_NOT_VERIFIED"},{status:403});if(!(await rateLimit(`checkout:${user.id}:${clientIp(request)}`,10,3600)).allowed)return NextResponse.json({error:"RATE_LIMITED"},{status:429});const input=checkoutSchema.parse(await request.json());const result=await createCheckout(user.id,input.accountId,input.items);return NextResponse.json(result,{status:201})}catch(e){return apiError(e)}}
