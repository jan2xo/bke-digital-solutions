import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecentAdmin } from "@/apps/web/auth/session";
import { assertSameOrigin } from "@/apps/web/http/request";
import { grantProductTrial } from "@/apps/web/trials/service";
import { apiError } from "@/apps/web/http/api-error";
const schema=z.object({accountId:z.string().cuid(),editionId:z.string().cuid(),graceDays:z.number().int().min(0).max(14).default(0)}).strict();
export async function POST(request:Request){try{assertSameOrigin(request);const admin=await requireRecentAdmin();const input=schema.parse(await request.json());const trial=await grantProductTrial({...input,source:"ADMIN",actorId:admin.id});return NextResponse.json(trial,{status:201})}catch(error){return apiError(error)}}
