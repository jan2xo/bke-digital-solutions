import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyHyperdriveMetadata } from "../scripts/deploy-staging.mjs";
const keys=["APP_URL","DEPLOYMENT_ENV","DEPLOYMENT_ID","REDIS_KEY_PREFIX","PAYMENT_PROVIDER","PAYMONGO_LIVEMODE","EMAIL_PROVIDER","GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","STAGING_NEON_HOST","DATABASE_URL","DIRECT_DATABASE_URL","SESSION_SECRET","MFA_ENCRYPTION_KEY","LICENSE_PEPPER","LICENSE_SIGNING_PRIVATE_KEY","LICENSE_SIGNING_PUBLIC_KEY","SUPPLY_CHAIN_SIGNING_PRIVATE_KEY","ADMIN_OWNER_RECOVERY_KEY","CRON_SECRET","S3_ACCESS_KEY_ID","S3_SECRET_ACCESS_KEY","REDIS_URL","UPSTASH_REDIS_REST_URL","UPSTASH_REDIS_REST_TOKEN","EMAIL_FROM","CLOUDFLARE_API_TOKEN","HYPERDRIVE_FRESH_ID"] as const;
const saved=new Map(keys.map(k=>[k,process.env[k]]));
const host="ep-example.ap-southeast-1.aws.neon.tech";
const db=`postgresql://bke_staging_owner:secret@${host}:5432/bke_staging?sslmode=require`;
function setup(){
 delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
 Object.assign(process.env,{APP_URL:"https://bke-digital-solutions.jlprojectfreedom.workers.dev",DEPLOYMENT_ENV:"staging",DEPLOYMENT_ID:"bke-digital-solutions-try",REDIS_KEY_PREFIX:"bke-digital-solutions-try",PAYMENT_PROVIDER:"mock",PAYMONGO_LIVEMODE:"false",EMAIL_PROVIDER:"log",GOOGLE_CLIENT_ID:"id",GOOGLE_CLIENT_SECRET:"secret",STAGING_NEON_HOST:host,DATABASE_URL:db,DIRECT_DATABASE_URL:db,SESSION_SECRET:"s".repeat(64),MFA_ENCRYPTION_KEY:"m".repeat(64),LICENSE_PEPPER:"p".repeat(64),LICENSE_SIGNING_PRIVATE_KEY:"private-signing-key",LICENSE_SIGNING_PUBLIC_KEY:"public-signing-key",SUPPLY_CHAIN_SIGNING_PRIVATE_KEY:"private-supply-key",ADMIN_OWNER_RECOVERY_KEY:"a".repeat(64),CRON_SECRET:"c".repeat(64),S3_ACCESS_KEY_ID:"key",S3_SECRET_ACCESS_KEY:"secret",REDIS_URL:"rediss://redis.example.invalid:6379",EMAIL_FROM:"staging@example.invalid"});
}
beforeEach(setup); afterEach(()=>{for(const k of keys){const v=saved.get(k);if(v===undefined)delete process.env[k];else process.env[k]=v;}});
function drive(){return {id:"a".repeat(32),name:"bke-digital-solutions-staging-fresh",origin:{database:"bke_staging",user:"bke_staging_owner",host,scheme:"postgres",port:5432},mtls:{sslmode:"require"},caching:{disabled:true}};}
describe("protected Staging guards",()=>{
 it("rejects wrong public destination and namespace",async()=>{
  const {assertStagingSettings}=await import("../scripts/deploy-staging.mjs");
  expect(()=>assertStagingSettings()).not.toThrow();
  process.env.APP_URL="https://jl-bke.com"; expect(()=>assertStagingSettings()).toThrow();
  setup(); process.env.DEPLOYMENT_ID="staging"; expect(()=>assertStagingSettings()).toThrow();
  setup(); process.env.REDIS_KEY_PREFIX="staging"; expect(()=>assertStagingSettings()).toThrow();
 });
 it("rejects wrong Neon host, database, role, TLS, or pooler",async()=>{
  const {assertStagingSettings}=await import("../scripts/deploy-staging.mjs");
  for(const value of [
   `postgresql://bke_staging_owner:secret@${host}:5432/bke_staging?sslmode=disable`,
   `postgresql://other:secret@${host}:5432/bke_staging?sslmode=require`,
   `postgresql://bke_staging_owner:secret@${host}:5432/other?sslmode=require`,
   `postgresql://bke_staging_owner:secret@${host}:5432/bke_staging-pooler?sslmode=require`,
  ]){process.env.DIRECT_DATABASE_URL=value;expect(()=>assertStagingSettings()).toThrow();setup();}
  const poolerHost="ep-example-pooler.ap-southeast-1.aws.neon.tech";
  process.env.STAGING_NEON_HOST=poolerHost;
  process.env.DIRECT_DATABASE_URL=`postgresql://bke_staging_owner:secret@${poolerHost}:5432/bke_staging?sslmode=require`;
  expect(()=>assertStagingSettings()).toThrow(/STAGING_NEON_HOST must be the exact direct Neon hostname/);
  setup();
  process.env.STAGING_NEON_HOST="wrong.neon.tech"; expect(()=>assertStagingSettings()).toThrow();
 });
 it("requires a matching PostgreSQL 5432 Hyperdrive origin and disabled caching",()=>{
  const original=drive(), url=new URL(db);
  expect(verifyHyperdriveMetadata(original,original.id,url,host)).toBe(true);
  type TestDrive = ReturnType<typeof drive>;
  const changes: Array<(d: TestDrive) => void> = [
   d => { d.origin.host="other.neon.tech"; }, d => { d.origin.database="other"; },
   d => { d.origin.user="other"; }, d => { d.origin.scheme="mysql"; }, d => { d.origin.port=3306; },
   d => { d.caching.disabled=false; }, d => { d.mtls!.sslmode="disable"; },
  ];
  const defaultTls={id:original.id,name:original.name,origin:structuredClone(original.origin),caching:structuredClone(original.caching)};
  expect(verifyHyperdriveMetadata(defaultTls,defaultTls.id,url,host)).toBe(true);
  const postgresql=structuredClone(original); postgresql.origin.scheme="postgresql";
  expect(verifyHyperdriveMetadata(postgresql,postgresql.id,url,host)).toBe(true);
  for(const change of changes){const d=structuredClone(original);change(d);expect(()=>verifyHyperdriveMetadata(d,d.id,url,host)).toThrow();}
 });
 it("requires Redis and strips inherited routes, vars, DB and deployment credentials",async()=>{
  const {buildStagingArtifacts}=await import("../scripts/deploy-staging.mjs");
  const config={name:"bke-digital-solutions",hyperdrive:[{binding:"HYPERDRIVE_FRESH",id:"0".repeat(32),localConnectionString:"postgresql://fixture"}],vars:{BKE_RUNTIME:"workers"},triggers:{}};
  delete process.env.REDIS_URL; expect(()=>buildStagingArtifacts(config,process.env,"a".repeat(32))).toThrow(/Redis/);
  process.env.UPSTASH_REDIS_REST_URL="http://redis.example.invalid"; process.env.UPSTASH_REDIS_REST_TOKEN="token";
  expect(()=>buildStagingArtifacts(config,process.env,"a".repeat(32))).toThrow(/HTTPS/);
  setup();
  process.env.REDIS_URL="rediss://redis.example.invalid:6379"; process.env.CLOUDFLARE_API_TOKEN="deploy-only";
  const artifacts=buildStagingArtifacts(config,process.env,"a".repeat(32));
  expect(artifacts.config.workers_dev).toBe(true); expect(artifacts.config.vars).not.toHaveProperty("DATABASE_URL");
  expect(artifacts.secrets).not.toHaveProperty("DIRECT_DATABASE_URL"); expect(artifacts.secrets).not.toHaveProperty("CLOUDFLARE_API_TOKEN");
  expect(()=>buildStagingArtifacts({...config,routes:[{pattern:"*"}]},process.env,"a".repeat(32))).toThrow(/routes/);
  expect(()=>buildStagingArtifacts({...config,env:{staging:{}}},process.env,"a".repeat(32))).toThrow(/environments/);
  expect(()=>buildStagingArtifacts({...config,vars:{DATABASE_URL:"leak"}},process.env,"a".repeat(32))).toThrow();
 });
});
