import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/security/request";
import { grantProductTrial } from "@/lib/trials";
import { apiError } from "@/lib/http";
const schema=z.object({accountId:z.string().cuid(),editionId:z.string().cuid(),graceDays:z.number().int().min(0).max(14).default(0)}).strict();
export async function POST(request:Request){try{assertSameOrigin(request);const admin=await requireAdmin();const input=schema.parse(await request.json());const trial=await grantProductTrial({...input,source:"ADMIN",actorId:admin.id});return NextResponse.json(trial,{status:201})}catch(error){return apiError(error)}}
