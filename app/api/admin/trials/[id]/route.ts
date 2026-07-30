import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/security/request";
import { changeTrial } from "@/lib/trials";
import { apiError } from "@/lib/http";
const schema=z.discriminatedUnion("action",[z.object({action:z.literal("SET_GRACE"),graceDays:z.number().int().min(0).max(14)}),z.object({action:z.literal("REVOKE")})]);
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{assertSameOrigin(request);const admin=await requireAdmin();const{id}=await params;const input=schema.parse(await request.json());return NextResponse.json(await changeTrial({trialId:id,actorId:admin.id,...input}))}catch(error){return apiError(error)}}
