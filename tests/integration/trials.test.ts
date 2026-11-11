import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../platform/host/generated/prisma/client";
import { changeTrial, grantProductTrial } from "@/apps/web/trials/service";
import { readAgentSoftwareCatalog } from "@/apps/web/catalog/agent-software-catalog";

const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL!})});
let userId="",adminId="",accountId="",editionId="",trialId="",licenseId="";

type TrialRight = {
  id: string;
  subjectId: string;
  resourceId: string;
  sourceReference: string;
  status: "ACTIVE" | "REVOKED";
  validFrom: Date;
  validUntil: Date | null;
  revokedAt: Date | null;
  revocationReference: string | null;
  revocationSnapshot: { reason?: string; actorId?: string; trialId?: string } | null;
  grantSnapshot: { source?: string; trialId?: string; licenseId?: string };
};

async function trialRights(orderId: string, orderItemId: string): Promise<TrialRight[]> {
  const ref = `commerce:${orderId}:${orderItemId}`;
  return db.$queryRaw<TrialRight[]>`
    SELECT "id", "subjectId", "resourceId", "sourceReference", "status",
           "validFrom", "validUntil", "revokedAt", "revocationReference",
           "revocationSnapshot", "grantSnapshot"
      FROM "Entitlement"
     WHERE "sourceReference" = ${ref}
  `;
}

describe("product trial lifecycle", { concurrent: false },()=>{
  beforeAll(async()=>{const suffix=Date.now().toString(36);const user=await db.user.create({data:{email:`trial-${suffix}@bke.test`,emailVerified:new Date(),ownedAccounts:{create:{type:"INDIVIDUAL",displayName:"Trial Customer",billingEmail:`trial-${suffix}@bke.test`}}},include:{ownedAccounts:true}});userId=user.id;accountId=user.ownedAccounts[0]!.id;adminId=(await db.user.create({data:{email:`trial-admin-${suffix}@bke.test`,emailVerified:new Date(),role:"ADMIN"}})).id;editionId=(await db.edition.findFirstOrThrow({where:{product:{slug:"bke-deskflow"},active:true}})).id});
  afterAll(()=>db.$disconnect());
  it("issues one seven-day self-service product entitlement",async()=>{const trial=await grantProductTrial({accountId,editionId,source:"SELF_SERVICE",actorId:userId});trialId=trial.id;licenseId=trial.licenseId;expect(trial.selfServiceYear).toBe(new Date().getUTCFullYear());expect(trial.trialEndsAt.getTime()-trial.trialStartsAt.getTime()).toBe(7*86400000);expect(trial.graceEndsAt).toEqual(trial.trialEndsAt);const license=await db.license.findUniqueOrThrow({where:{id:licenseId},include:{order:true}});expect(license.status).toBe("ACTIVE");expect(license.order.totalMinor).toBe(0);expect(license.expiresAt).toEqual(trial.graceEndsAt);expect(license.order.status).toBe("PAID");const rights=await trialRights(license.orderId,license.orderItemId);expect(rights).toHaveLength(1);const right=rights[0]!;expect(right).toMatchObject({subjectId:accountId,resourceId:editionId,status:"ACTIVE",grantSnapshot:{source:"TRIAL",trialId:trial.id,licenseId}});expect(right.validFrom).toEqual(trial.trialStartsAt);expect(right.validUntil).toEqual(trial.trialEndsAt);const catalog=await db.$transaction((tx)=>readAgentSoftwareCatalog(tx,{accountId,userId,platform:"windows",architecture:"x64"}));expect(catalog.find(item=>item.productId==="bke-deskflow")?.entitled).toBe(true)});
  it("rejects another edition of the same product in the same account and year",async()=>{const original=await db.edition.findUniqueOrThrow({where:{id:editionId}});const alternate=await db.edition.create({data:{productId:original.productId,slug:`trial-alt-${Date.now().toString(36)}`,name:"Trial alternate",maxUsers:1,maxDevicesPerUser:1}});try{await expect(grantProductTrial({accountId,editionId:alternate.id,source:"SELF_SERVICE",actorId:userId})).rejects.toThrow("TRIAL_ALREADY_USED_THIS_YEAR");expect(await db.trialGrant.count({where:{accountId,productId:original.productId,selfServiceYear:new Date().getUTCFullYear()}})).toBe(1)}finally{await db.edition.delete({where:{id:alternate.id}})}});
  it("issues exactly one entitlement under concurrent self-service requests",async()=>{const suffix=Date.now().toString(36);const concurrent=await db.user.create({data:{email:`trial-concurrent-${suffix}@bke.test`,emailVerified:new Date(),ownedAccounts:{create:{type:"INDIVIDUAL",displayName:"Concurrent Trial",billingEmail:`trial-concurrent-${suffix}@bke.test`}}},include:{ownedAccounts:true}});const concurrentAccountId=concurrent.ownedAccounts[0]!.id;const results=await Promise.allSettled([grantProductTrial({accountId:concurrentAccountId,editionId,source:"SELF_SERVICE",actorId:concurrent.id}),grantProductTrial({accountId:concurrentAccountId,editionId,source:"SELF_SERVICE",actorId:concurrent.id})]);expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);expect(await db.trialGrant.count({where:{accountId:concurrentAccountId,product:{slug:"bke-deskflow"},selfServiceYear:new Date().getUTCFullYear()}})).toBe(1);expect(await db.license.count({where:{accountId:concurrentAccountId,product:{slug:"bke-deskflow"}}})).toBe(1);const granted=await db.$queryRaw<Array<{count:number}>>`SELECT COUNT(*)::integer AS "count" FROM "Entitlement" WHERE "subjectId" = ${concurrentAccountId} AND "grantSnapshot"->>'source' = 'TRIAL'`;expect(granted[0]?.count).toBe(1)});
  it("allows an administrator to grant an extra trial with grace",async()=>{const trial=await grantProductTrial({accountId,editionId,source:"ADMIN",actorId:adminId,graceDays:3});expect(trial.selfServiceYear).toBeNull();expect(trial.graceEndsAt.getTime()-trial.trialEndsAt.getTime()).toBe(3*86400000);expect(await db.auditLog.count({where:{targetId:trial.id,action:"TRIAL_GRANTED_BY_ADMIN"}})).toBe(1);const license=await db.license.findUniqueOrThrow({where:{id:trial.licenseId}});const rights=await trialRights(license.orderId,license.orderItemId);expect(rights).toHaveLength(1);expect(rights[0]?.validUntil).toEqual(trial.trialEndsAt);expect(rights[0]?.grantSnapshot.source).toBe("TRIAL")});
  it("changes grace and revokes access and devices transactionally",async()=>{const changed=await changeTrial({trialId,actorId:adminId,action:"SET_GRACE",graceDays:5});expect(changed.graceEndsAt.getTime()-changed.trialEndsAt.getTime()).toBe(5*86400000);const licenseAfterGrace=await db.license.findUniqueOrThrow({where:{id:licenseId}});expect(licenseAfterGrace.expiresAt).toEqual(changed.graceEndsAt);expect((await trialRights(licenseAfterGrace.orderId,licenseAfterGrace.orderItemId))[0]?.validUntil).toEqual(changed.trialEndsAt);const device=await db.deviceActivation.create({data:{licenseId,deviceHash:`trial-device-${Date.now()}`}});const revoked=await changeTrial({trialId,actorId:adminId,action:"REVOKE"});expect((await db.license.findUniqueOrThrow({where:{id:licenseId}})).status).toBe("REVOKED");expect(revoked.revokedAt).not.toBeNull();const rightAfterRevocation=(await trialRights(licenseAfterGrace.orderId,licenseAfterGrace.orderItemId))[0]!;expect(rightAfterRevocation.status).toBe("REVOKED");expect(rightAfterRevocation.revokedAt).toEqual(revoked.revokedAt);expect(rightAfterRevocation.revocationReference).toBe(`trial:${trialId}:revoked`);expect(rightAfterRevocation.revocationSnapshot).toMatchObject({reason:"TRIAL_REVOKED",actorId:adminId,trialId});expect(await db.deviceActivation.findUniqueOrThrow({where:{id:device.id}})).toMatchObject({active:false});expect(await db.licenseEvent.count({where:{licenseId,type:"TRIAL_REVOKED"}})).toBe(1);const repeated=await changeTrial({trialId,actorId:adminId,action:"REVOKE"});expect(repeated.revokedAt).toEqual(revoked.revokedAt);expect(await db.licenseEvent.count({where:{licenseId,type:"TRIAL_REVOKED"}})).toBe(1);expect((await trialRights(licenseAfterGrace.orderId,licenseAfterGrace.orderItemId))[0]?.revocationReference).toBe(`trial:${trialId}:revoked`)});
  it("rejects grace changes after revocation with a specific state error",async()=>{await expect(changeTrial({trialId,actorId:adminId,action:"SET_GRACE",graceDays:3})).rejects.toThrow("TRIAL_REVOKED")});
});
