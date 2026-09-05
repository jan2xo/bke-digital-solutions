import {NextResponse} from "next/server";
import {z} from "zod";
import {requireRecentAdmin} from "@/lib/auth";
import {db} from "@/lib/db";
import {assertSameOrigin} from "@/v2/apps/web/http/request";
import {audit} from "@/v2/apps/web/audit";
import {apiError} from "@/v2/apps/web/http/api-error";
import {decryptLicenseKey, sha256} from "@/lib/security/crypto";
import {addDays} from "@/v2/apps/web/time";
import {issueCommercialLease} from "@/lib/licensing/commercial-lease";

const schema=z.discriminatedUnion("action",[
  z.object({action:z.enum(["ACTIVATE","SUSPEND","REVOKE","EXPIRE"])}),
  z.object({action:z.literal("RENEW"),days:z.number().int().min(1).max(3650).default(365)}),
  z.object({action:z.literal("TRANSFER"),accountId:z.string().cuid(),installationId:z.string().min(1).max(200),deviceId:z.string().min(1).max(200)}),
  z.object({action:z.literal("REVEAL")}),
]);

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);const admin=await requireRecentAdmin();const{id}=await params;
    const input=schema.parse(await request.json());
    const current=await db.license.findUniqueOrThrow({where:{id}});let plaintext:string|undefined;
    if(input.action==="TRANSFER"){
      if(current.status!=="ACTIVE" || !current.keyCiphertext) throw new Error("TRANSFER_NOT_ALLOWED");
      const item=await db.orderItem.findUniqueOrThrow({where:{id:current.orderItemId},select:{policyId:true}});
      const policy=await db.licensePolicy.findUnique({where:{id:item.policyId},select:{transferable:true}});
      if(!policy?.transferable) throw new Error("TRANSFER_NOT_ALLOWED");
      const operationId=`transfer:${id}:${input.accountId}:${input.installationId}:${input.deviceId}`;
      const existing=await db.commercialLeaseOperation.findUnique({where:{operationId}});
      const storedMetadata=existing?.metadata as Record<string,unknown>|undefined;
      const sourceLease=existing ? (storedMetadata?.predecessorLeaseId ? await db.licenseLeaseRecord.findUnique({where:{leaseId:String(storedMetadata.predecessorLeaseId)}}) : null) : await db.licenseLeaseRecord.findFirst({where:{licenseId:id,status:"ACTIVE"},orderBy:[{generation:"desc"},{serverRevision:"desc"}]});
      if(!sourceLease?.version) throw new Error("TRANSFER_SOURCE_VERSION_REQUIRED");
      const metadata={sourceAccountId:storedMetadata?.sourceAccountId ?? current.accountId,targetAccountId:input.accountId,installationId:input.installationId,deviceId:input.deviceId,policyId:item.policyId,predecessorLeaseId:sourceLease?.leaseId??null,sourceInstallationId:sourceLease?.installationId??null,sourceDeviceId:sourceLease?.deviceId??null,actorId:admin.id};
      if(existing){const prior=existing.metadata as Record<string,unknown>;for(const [key,value] of Object.entries(metadata)) if(["sourceAccountId","targetAccountId","installationId","deviceId","policyId","predecessorLeaseId"].includes(key)&&prior[key]!==value) throw new Error("TRANSFER_REPLAY_MISMATCH");}
      const prepared=existing??await db.commercialLeaseOperation.create({data:{operationId,licenseId:id,action:"TRANSFER",status:"PREPARED",metadata}});
      if(prepared.status!=="COMPLETED") await issueCommercialLease({licenseKey:decryptLicenseKey(current.keyCiphertext),installationId:input.installationId,deviceId:input.deviceId,operationId,productVersion:sourceLease.version,action:"TRANSFER",predecessorLeaseId:sourceLease.leaseId});
      const finalized=await db.$transaction(async tx=>{const op=await tx.commercialLeaseOperation.findUniqueOrThrow({where:{operationId}});if(!op.resultLeaseId)throw new Error("TRANSFER_LEASE_REQUIRED");await tx.customerAccount.findUniqueOrThrow({where:{id:input.accountId}});await tx.deviceActivation.updateMany({where:{licenseId:id,active:true,deviceHash:{not:sha256(input.deviceId)}},data:{active:false,deactivatedAt:new Date()}});const updated=await tx.license.update({where:{id},data:{accountId:input.accountId,events:{create:{type:"TRANSFERRED",metadata:{actorId:admin.id,fromAccountId:current.accountId,toAccountId:input.accountId,operationId,leaseId:op.resultLeaseId}}}}});await tx.commercialLeaseOperation.update({where:{operationId},data:{status:"COMPLETED",completedAt:new Date()}});return updated});await audit({actorId:admin.id,accountId:finalized.accountId,action:"LICENSE_TRANSFER",targetType:"License",targetId:id,metadata:{fromAccountId:current.accountId,toAccountId:input.accountId,operationId}});return NextResponse.json({id:finalized.id,status:finalized.status,expiresAt:finalized.expiresAt,operationId},{status:200});
    }
    const license=await db.$transaction(async tx=>{
      if(input.action==="REVEAL"){
        if(!current.keyCiphertext)throw new Error("LICENSE_KEY_UNAVAILABLE");
        plaintext=decryptLicenseKey(current.keyCiphertext);
        return tx.license.update({where:{id},data:{keyRevealedAt:current.keyRevealedAt??new Date(),events:{create:{type:"ADMIN_REVEALED",metadata:{actorId:admin.id}}}}});
      }
      if(input.action==="RENEW")return tx.license.update({where:{id},data:{status:"ACTIVE",expiresAt:addDays(current.expiresAt&&current.expiresAt>new Date()?current.expiresAt:new Date(),input.days),events:{create:{type:"RENEWED",metadata:{actorId:admin.id,days:input.days}}}}});
      const status=input.action==="ACTIVATE"?"ACTIVE":input.action==="EXPIRE"?"EXPIRED":input.action==="SUSPEND"?"SUSPENDED":"REVOKED";
      if(status!=="ACTIVE")await tx.deviceActivation.updateMany({where:{licenseId:id,active:true},data:{active:false,deactivatedAt:new Date()}});
      if(input.action==="REVOKE"){
        const operationId=`revocation:${id}`;
        const predecessor=await tx.licenseLeaseRecord.findFirst({where:{licenseId:id,status:"ACTIVE"},orderBy:{issuedAt:"desc"},select:{leaseId:true}});
        await tx.commercialLeaseOperation.upsert({where:{operationId},create:{operationId,licenseId:id,action:"REVOCATION_REPLACEMENT",status:"COMPLETED",metadata:{reason:"ADMIN_REVOKE",actorId:admin.id,revokedAt:new Date().toISOString(),predecessorLeaseId:predecessor?.leaseId??null,decision:"REFUSED_ACTIVE_ISSUANCE"},completedAt:new Date()},update:{}});
      }
      return tx.license.update({where:{id},data:{status,events:{create:{type:status,metadata:{actorId:admin.id}}}}});
    });
    await audit({actorId:admin.id,accountId:license.accountId,action:`LICENSE_${input.action}`,targetType:"License",targetId:id,metadata:{fromAccountId:current.accountId}});
    return NextResponse.json({id:license.id,status:license.status,expiresAt:license.expiresAt,...plaintext?{licenseKey:plaintext}:{}});
  }catch(e){return apiError(e)}
}
