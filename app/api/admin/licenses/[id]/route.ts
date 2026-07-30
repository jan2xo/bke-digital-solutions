import {NextResponse} from "next/server";
import {z} from "zod";
import {requireAdmin} from "@/lib/auth";
import {db} from "@/lib/db";
import {assertSameOrigin} from "@/lib/security/request";
import {audit} from "@/lib/audit";
import {apiError} from "@/lib/http";
import {decryptLicenseKey} from "@/lib/security/crypto";
import {addDays} from "@/lib/time";

const schema=z.discriminatedUnion("action",[
  z.object({action:z.enum(["ACTIVATE","SUSPEND","REVOKE","EXPIRE"])}),
  z.object({action:z.literal("RENEW"),days:z.number().int().min(1).max(3650).default(365)}),
  z.object({action:z.literal("TRANSFER"),accountId:z.string().cuid()}),
  z.object({action:z.literal("REVEAL")}),
]);

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);const admin=await requireAdmin();const{id}=await params;
    const input=schema.parse(await request.json());
    const current=await db.license.findUniqueOrThrow({where:{id}});let plaintext:string|undefined;
    const license=await db.$transaction(async tx=>{
      if(input.action==="REVEAL"){
        if(current.keyRevealedAt||!current.keyCiphertext)throw new Error("KEY_ALREADY_REVEALED");
        plaintext=decryptLicenseKey(current.keyCiphertext);
        return tx.license.update({where:{id},data:{keyRevealedAt:new Date(),events:{create:{type:"ADMIN_REVEALED",metadata:{actorId:admin.id}}}}});
      }
      if(input.action==="TRANSFER"){
        await tx.customerAccount.findUniqueOrThrow({where:{id:input.accountId}});
        await tx.deviceActivation.updateMany({where:{licenseId:id,active:true},data:{active:false,deactivatedAt:new Date()}});
        return tx.license.update({where:{id},data:{accountId:input.accountId,events:{create:{type:"TRANSFERRED",metadata:{actorId:admin.id,fromAccountId:current.accountId,toAccountId:input.accountId}}}}});
      }
      if(input.action==="RENEW")return tx.license.update({where:{id},data:{status:"ACTIVE",expiresAt:addDays(current.expiresAt&&current.expiresAt>new Date()?current.expiresAt:new Date(),input.days),events:{create:{type:"RENEWED",metadata:{actorId:admin.id,days:input.days}}}}});
      const status=input.action==="ACTIVATE"?"ACTIVE":input.action==="EXPIRE"?"EXPIRED":input.action==="SUSPEND"?"SUSPENDED":"REVOKED";
      if(status!=="ACTIVE")await tx.deviceActivation.updateMany({where:{licenseId:id,active:true},data:{active:false,deactivatedAt:new Date()}});
      return tx.license.update({where:{id},data:{status,events:{create:{type:status,metadata:{actorId:admin.id}}}}});
    });
    await audit({actorId:admin.id,accountId:license.accountId,action:`LICENSE_${input.action}`,targetType:"License",targetId:id,metadata:{fromAccountId:current.accountId,...input.action==="TRANSFER"?{toAccountId:input.accountId}:{}}});
    return NextResponse.json({id:license.id,status:license.status,expiresAt:license.expiresAt,...plaintext?{licenseKey:plaintext}:{}});
  }catch(e){return apiError(e)}
}
