import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security/request";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/http";
import { z } from "zod";
const schema=z.object({status:z.enum(["ACTIVE","SUSPENDED","REVOKED"])});
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{assertSameOrigin(request);const admin=await requireAdmin();const{id}=await params;const input=schema.parse(await request.json());const license=await db.license.update({where:{id},data:{status:input.status,events:{create:{type:input.status,metadata:{actorId:admin.id}}}}});await audit({actorId:admin.id,accountId:license.accountId,action:`LICENSE_${input.status}`,targetType:"License",targetId:id});return NextResponse.json({id:license.id,status:license.status})}catch(e){return apiError(e)}}
