import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { assertLegalAcceptanceCurrent } from "@/lib/legal/service";
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){try{const user=await requireUser();await assertLegalAcceptanceCurrent(user.id);const {id}=await params;const order=await db.order.findFirst({where:{id,account:{OR:[{ownerId:user.id},{memberships:{some:{userId:user.id,role:{in:["OWNER","BILLING"]}}}}]}},select:{id:true,number:true,status:true,currency:true,totalMinor:true,paidAt:true}});if(!order)throw new Error("NOT_FOUND");return NextResponse.json(order)}catch(e){return apiError(e)}}
