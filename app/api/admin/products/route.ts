import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin } from "@/lib/security/request";
import { audit } from "@/lib/audit";
import { apiError } from "@/lib/http";
import { z } from "zod";
const schema=z.object({slug:z.string().regex(/^[a-z0-9-]+$/).max(80),name:z.string().trim().min(2).max(120),summary:z.string().trim().min(10).max(240),description:z.string().trim().min(10).max(10000),type:z.enum(["SOFTWARE","SAAS","HYBRID"])});
export async function GET(){try{await requireAdmin();return NextResponse.json(await db.product.findMany({include:{prices:true,policies:true,versions:true}}))}catch(e){return apiError(e)}}
export async function POST(request:Request){try{assertSameOrigin(request);const admin=await requireAdmin();const input=schema.parse(await request.json());const product=await db.product.create({data:input});await audit({actorId:admin.id,action:"PRODUCT_CREATED",targetType:"Product",targetId:product.id,metadata:{slug:product.slug}});return NextResponse.json(product,{status:201})}catch(e){return apiError(e)}}
