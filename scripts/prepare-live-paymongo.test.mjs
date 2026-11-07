import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertLiveSettings, buildLiveArtifacts, verifyLiveHyperdrive, LIVE_ORIGIN } from "./prepare-live-paymongo.mjs";

const host="ep-live.ap-southeast-1.aws.neon.tech";
const url="postgresql://bke_production_owner:secret@"+host+"/bke_production?sslmode=require";
const realId="0123456789abcdef0123456789abcdef";
const env={
  NODE_ENV:"production",APP_URL:LIVE_ORIGIN,DEPLOYMENT_ENV:"production",
  DEPLOYMENT_ID:"bke-digital-solutions-live",REDIS_KEY_PREFIX:"bke-digital-solutions-live",
  PAYMENT_PROVIDER:"paymongo",PAYMONGO_LIVEMODE:"true",
  PAYMONGO_SECRET_KEY:"sk_live_"+"a".repeat(24),PAYMONGO_WEBHOOK_SECRET:"whsec_"+"b".repeat(24),
  PROVIDER_CONFIG_SOURCE:"environment",PROVIDER_CONFIG_ALLOW_ENV_FALLBACK:"false",
  EMAIL_PROVIDER:"cloudflare",EMAIL_FROM:"BKE <noreply@bkedigitalsolutions.com>",
  GOOGLE_CLIENT_ID:"production-google-id",GOOGLE_CLIENT_SECRET:"production-google-secret",
  SESSION_SECRET:"s".repeat(64),LICENSE_PEPPER:"p".repeat(64),CRON_SECRET:"c".repeat(64),
  LICENSE_SIGNING_PRIVATE_KEY:"K".repeat(80),LICENSE_SIGNING_PUBLIC_KEY:"P".repeat(48),
  SUPPORT_EMAIL:"support@bkedigitalsolutions.com",
  BACKUP_ENABLED:"true",BACKUP_OFFSITE_ACK:"SEPARATE_FAILURE_DOMAIN",
  BACKUP_BUCKET:"bke-production-backups",BACKUP_ENCRYPTION_KEY:"E".repeat(64),
  BACKUP_S3_ACCESS_KEY_ID:"backup-access",BACKUP_S3_SECRET_ACCESS_KEY:"backup-secret",
  PRODUCTION_NEON_HOST:host,DATABASE_URL:url,DIRECT_DATABASE_URL:url,REDIS_URL:"rediss://redis.example.invalid:6379",
  HYPERDRIVE_ID:realId,
};
const original={
  name:"bke-digital-solutions",main:"workers/entry.ts",
  hyperdrive:[{binding:"HYPERDRIVE_FRESH",id:"0".repeat(32),localConnectionString:"postgresql://local"}],
  services:[{binding:"WORKER_SELF_REFERENCE",service:"bke-digital-solutions"}],
  vars:{BKE_RUNTIME:"workers"},
  observability:{enabled:true,redact_query_string:true},
};
const drive={id:realId,name:"bke-digital-solutions-production",
  origin:{database:"bke_production",user:"bke_production_owner",host,scheme:"postgres",port:5432},
  caching:{disabled:true},mtls:{sslmode:"require"}};

describe("legacy PayMongo LIVE cutover preflight — NO provider calls",()=>{
 it("requires genuine production mode and isolated database",()=>{
   assert.equal(assertLiveSettings(env).pathname,"/bke_production");
   assert.equal(verifyLiveHyperdrive(drive,realId,new URL(url),env),true);
 });
 it("builds only the authorized apex route, production DB binding and allowlisted credentials",()=>{
   const {config,secrets}=buildLiveArtifacts(original,env,realId);
   assert.deepEqual(config.routes,[{pattern:"bkedigitalsolutions.com",custom_domain:true}]);
   assert.equal(config.workers_dev,false);
   assert.equal(config.vars.DEPLOYMENT_ENV,"production");
   assert.equal(config.vars.PAYMONGO_LIVEMODE,"true");
   assert.equal(config.vars.PAYMENT_PROVIDER,"paymongo");
   assert.equal(config.hyperdrive[0].id,realId);
   assert.equal("localConnectionString" in config.hyperdrive[0],false);
   assert.equal("PAYMONGO_SECRET_KEY" in config.vars,false);
   assert.equal("PAYMONGO_WEBHOOK_SECRET" in config.vars,false);
   assert.equal("DATABASE_URL" in config.vars,false);
   assert.equal("CLOUDFLARE_API_TOKEN" in secrets,false);
   assert.equal("DIRECT_DATABASE_URL" in secrets,false);
   assert.equal(secrets.PAYMONGO_SECRET_KEY,env.PAYMONGO_SECRET_KEY);
   assert.equal(secrets.PAYMONGO_WEBHOOK_SECRET,env.PAYMONGO_WEBHOOK_SECRET);
   assert.equal(original.hyperdrive[0].id,"0".repeat(32));
 });
 const invalid=[
   [{APP_URL:"https://staging.bkedigitalsolutions.com"},"LIVE_APP_ORIGIN"],
   [{APP_URL:"https://bke-digital-solutions.jlprojectfreedom.workers.dev"},"LIVE_APP_ORIGIN"],
   [{DEPLOYMENT_ENV:"staging"},"LIVE_DEPLOYMENT_ENV"],
   [{DEPLOYMENT_ID:"bke-digital-solutions-try"},"LIVE_DEPLOYMENT_ID"],
   [{REDIS_KEY_PREFIX:"bke-digital-solutions-try"},"LIVE_REDIS_NAMESPACE"],
   [{PAYMENT_PROVIDER:"mock"},"LIVE_PAYMONGO_PROVIDER"],
   [{PAYMONGO_LIVEMODE:"false"},"LIVE_PAYMONGO_PROVIDER"],
   [{PAYMONGO_SECRET_KEY:"sk_test_"+"a".repeat(24)},"LIVE_PAYMONGO_KEY_MODE"],
   [{PAYMONGO_SECRET_KEY:""},"LIVE_REQUIRED_PAYMONGO_SECRET_KEY"],
   [{PAYMONGO_WEBHOOK_SECRET:""},"LIVE_REQUIRED_PAYMONGO_WEBHOOK_SECRET"],
   [{PROVIDER_CONFIG_SOURCE:"database"},"LIVE_PROVIDER_SOURCE"],
   [{PROVIDER_CONFIG_ALLOW_ENV_FALLBACK:"true"},"LIVE_PROVIDER_SOURCE"],
   [{EMAIL_PROVIDER:"log"},"LIVE_EMAIL_PROVIDER"],
   [{BACKUP_ENABLED:"false"},"LIVE_BACKUP_REQUIRED"],
   [{DIRECT_DATABASE_URL:url.replace("bke_production","bke_staging")},"LIVE_DATABASE_NAME"],
   [{DATABASE_URL:url.replace("bke_production_owner","bke_staging_owner")},"LIVE_DATABASE_ROLE"],
   [{DATABASE_URL:url+"&host=evil.neon.tech"},"LIVE_DATABASE_QUERY_OVERRIDE"],
   [{STAGING_NEON_HOST:host},"LIVE_STAGING_RESOURCE_INJECTION"],
   [{HYPERDRIVE_FRESH_ID:realId},"LIVE_STAGING_RESOURCE_INJECTION"],
 ];
 for(const [change,code] of invalid) {
   it("rejects unsafe config "+code+" "+Object.keys(change).join(","),()=>{
     assert.throws(()=>assertLiveSettings({...env,...change}),{message:code});
   });
 }
 it("rejects any staging Hyperdrive origin/name/caching mismatch",()=>{
   for(const patch of [
     {name:"bke-digital-solutions-staging-fresh"},
     {origin:{...drive.origin,database:"bke_staging"}},
     {origin:{...drive.origin,user:"bke_staging_owner"}},
     {caching:{disabled:false}},
   ]) assert.throws(()=>verifyLiveHyperdrive({...drive,...patch},realId,new URL(url),env));
 });
 it("never allows preconfigured wildcards or inherited secrets in Wrangler source",()=>{
   assert.throws(()=>buildLiveArtifacts({...original,routes:[{pattern:"*"}]},env,realId));
   assert.throws(()=>buildLiveArtifacts({...original,vars:{BKE_RUNTIME:"workers",PAYMONGO_SECRET_KEY:"oops"}},env,realId));
   assert.throws(()=>buildLiveArtifacts({...original,triggers:{crons:["* * * * *"]}},env,realId));
 });
 it("never reports credential bytes in failures",()=>{
   try {assertLiveSettings({...env,PAYMONGO_SECRET_KEY:"sk_test_private_value"});assert.fail("expected");}
   catch(e){assert.equal(e.message,"LIVE_PAYMONGO_KEY_MODE");assert.ok(!e.message.includes("private_value"));}
 });
});
