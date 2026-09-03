import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createCheckout } from "@/lib/checkout";
import { checkoutSchema } from "@/v2/apps/web/http/validation";
import { assertSameOrigin, clientIp } from "@/v2/apps/web/http/request";
import { rateLimit } from "@/v2/apps/web/http/rate-limit";
import { apiError } from "@/v2/apps/web/http/api-error";
import { assertLegalAcceptanceCurrent } from "@/lib/legal/service";
export async function POST(request:Request){try{assertSameOrigin(request);const user=await requireUser();await assertLegalAcceptanceCurrent(user.id);if(!user.emailVerified)return NextResponse.json({error:"EMAIL_NOT_VERIFIED"},{status:403});if(!(await rateLimit(`checkout:${user.id}:${clientIp(request)}`,10,3600)).allowed)return NextResponse.json({error:"RATE_LIMITED"},{status:429});const input=checkoutSchema.parse(await request.json());const result=await createCheckout(user.id,input.purchasePlanId,input.customerAccountId,input.offerIdentifier,undefined,{versionIds:input.legalVersionIds,request});return NextResponse.json(result,{status:201})}catch(e){return apiError(e)}}
