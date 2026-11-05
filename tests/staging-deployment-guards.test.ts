import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { databaseUrl, verifyHyperdriveMetadata, verifyObservabilityRedaction } from "../scripts/deploy-staging.mjs";
const keys=["MFA_ENCRYPTION_KEY","ADMIN_OWNER_RECOVERY_KEY","SUPPLY_CHAIN_SIGNING_PRIVATE_KEY","SUPPLY_CHAIN_SIGNING_PUBLIC_KEY","SUPPLY_CHAIN_SIGNING_KEY_ID","APP_URL","DEPLOYMENT_ENV","DEPLOYMENT_ID","REDIS_KEY_PREFIX","PAYMENT_PROVIDER","PAYMONGO_LIVEMODE","EMAIL_PROVIDER","GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","STAGING_NEON_HOST","DATABASE_URL","DIRECT_DATABASE_URL","SESSION_SECRET","MFA_ENCRYPTION_KEY","LICENSE_PEPPER","LICENSE_SIGNING_PRIVATE_KEY","LICENSE_SIGNING_PUBLIC_KEY","SUPPLY_CHAIN_SIGNING_PRIVATE_KEY","ADMIN_OWNER_RECOVERY_KEY","CRON_SECRET","REDIS_URL","UPSTASH_REDIS_REST_URL","UPSTASH_REDIS_REST_TOKEN","EMAIL_FROM","CLOUDFLARE_API_TOKEN","HYPERDRIVE_FRESH_ID"] as const;
const saved=new Map(keys.map(k=>[k,process.env[k]]));
const host="ep-example.ap-southeast-1.aws.neon.tech";
const db=`postgresql://bke_staging_owner:secret@${host}:5432/bke_staging?sslmode=require`;
function setup(){
 delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
 Object.assign(process.env,{APP_URL:"https://bke-digital-solutions.jlprojectfreedom.workers.dev",DEPLOYMENT_ENV:"staging",DEPLOYMENT_ID:"bke-digital-solutions-try",REDIS_KEY_PREFIX:"bke-digital-solutions-try",PAYMENT_PROVIDER:"mock",PAYMONGO_LIVEMODE:"false",EMAIL_PROVIDER:"log",GOOGLE_CLIENT_ID:"id",GOOGLE_CLIENT_SECRET:"secret",STAGING_NEON_HOST:host,DATABASE_URL:db,DIRECT_DATABASE_URL:db,SESSION_SECRET:"s".repeat(64),LICENSE_PEPPER:"p".repeat(64),LICENSE_SIGNING_PRIVATE_KEY:"private-signing-key",LICENSE_SIGNING_PUBLIC_KEY:"public-signing-key",CRON_SECRET:"c".repeat(64),REDIS_URL:"rediss://redis.example.invalid:6379",EMAIL_FROM:"staging@example.invalid"});
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
 it("rejects PostgreSQL connection query target overrides and duplicates",()=>{
  const valid=`postgresql://bke_staging_owner:secret@${host}:5432/bke_staging?sslmode=require&channel_binding=require`;
  expect(databaseUrl("DIRECT_DATABASE_URL",valid,host).hostname).toBe(host);
  for(const query of [
   "sslmode=require&host=other.neon.tech",
   "sslmode=require&user=other",
   "sslmode=require&port=6543",
   "sslmode=require&%68ost=other.neon.tech",
   "sslmode=disable&sslmode=require",
   "sslmode=require&sslmode=disable",
  ]) expect(()=>databaseUrl("DIRECT_DATABASE_URL",`postgresql://bke_staging_owner:secret@${host}:5432/bke_staging?${query}`,host)).toThrow(/query/);
 });
 it("requires query-string redaction in deployed observability settings",()=>{
  expect(verifyObservabilityRedaction({observability:{enabled:true,logs:{enabled:true},redact_query_string:true}})).toBe(true);
  expect(()=>verifyObservabilityRedaction({observability:{enabled:true,logs:{enabled:true},redact_query_string:false}})).toThrow(/logs and query-string redaction/);
  expect(()=>verifyObservabilityRedaction({observability:{enabled:false,logs:{enabled:true},redact_query_string:true}})).toThrow(/logs and query-string redaction/);
  expect(()=>verifyObservabilityRedaction({observability:{enabled:true,logs:{enabled:false},redact_query_string:true}})).toThrow(/logs and query-string redaction/);
  expect(()=>verifyObservabilityRedaction({observability:{enabled:true,redact_query_string:true}})).toThrow(/logs and query-string redaction/);
 });
 it("requires the explicit legal initialization acknowledgement before database creation",async()=>{
  const {withAuthorizedStagingDatabase}=await import("../scripts/initialize-staging-legal");
  let created=false;
  const env: NodeJS.ProcessEnv={...process.env,NODE_ENV:"production",SOURCE_SHA:"a".repeat(40),GITHUB_ACTOR:"operator"};
  await expect(withAuthorizedStagingDatabase(env,()=>{created=true;throw new Error("unexpected construction");},async()=>undefined)).rejects.toThrow("STAGING_LEGAL_ACK_REQUIRED");
  expect(created).toBe(false);
  const ack="I_APPROVE_THE_REVIEWED_STAGING_TEST_NOTICES";
  const invalidSettings: NodeJS.ProcessEnv[] = [
    {...env,INITIALIZE_STAGING_LEGAL_ACK:ack,NODE_ENV:"test"},
    {...env,INITIALIZE_STAGING_LEGAL_ACK:ack,DEPLOYMENT_ENV:"production"},
    {...env,INITIALIZE_STAGING_LEGAL_ACK:ack,APP_URL:"https://jl-bke.com"},
    {...env,INITIALIZE_STAGING_LEGAL_ACK:ack,DIRECT_DATABASE_URL:`postgresql://bke_staging_owner:secret@${host}:5432/bke_staging?sslmode=require&host=attacker.neon.tech`},
  ];
  for (const invalid of invalidSettings) {
    await expect(withAuthorizedStagingDatabase(invalid,()=>{created=true;throw new Error("unexpected construction");},async()=>undefined)).rejects.toThrow();
    expect(created).toBe(false);
  }
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
  const config={name:"bke-digital-solutions",hyperdrive:[{binding:"HYPERDRIVE_FRESH",id:"0".repeat(32),localConnectionString:"postgresql://fixture"}],observability:{enabled:true,redact_query_string:true},vars:{BKE_RUNTIME:"workers"},triggers:{}};
  delete process.env.REDIS_URL; expect(()=>buildStagingArtifacts(config,process.env,"a".repeat(32))).toThrow(/Redis/);
  process.env.UPSTASH_REDIS_REST_URL="http://redis.example.invalid"; process.env.UPSTASH_REDIS_REST_TOKEN="token";
  expect(()=>buildStagingArtifacts(config,process.env,"a".repeat(32))).toThrow(/HTTPS/);
  setup();
  process.env.REDIS_URL="rediss://redis.example.invalid:6379"; process.env.CLOUDFLARE_API_TOKEN="deploy-only";
  process.env.MFA_ENCRYPTION_KEY="retired"; process.env.ADMIN_OWNER_RECOVERY_KEY="retired";
  process.env.SUPPLY_CHAIN_SIGNING_PRIVATE_KEY="retired"; process.env.SUPPLY_CHAIN_SIGNING_PUBLIC_KEY="retired"; process.env.SUPPLY_CHAIN_SIGNING_KEY_ID="retired";
  const artifacts=buildStagingArtifacts(config,process.env,"a".repeat(32));
  expect(artifacts.config.workers_dev).toBe(true); expect(artifacts.config.vars).not.toHaveProperty("DATABASE_URL");
  expect(artifacts.secrets).not.toHaveProperty("DIRECT_DATABASE_URL"); expect(artifacts.secrets).not.toHaveProperty("CLOUDFLARE_API_TOKEN");
  expect(artifacts.secrets).not.toHaveProperty("MFA_ENCRYPTION_KEY"); expect(artifacts.secrets).not.toHaveProperty("ADMIN_OWNER_RECOVERY_KEY");
  expect(artifacts.secrets).not.toHaveProperty("SUPPLY_CHAIN_SIGNING_PRIVATE_KEY"); expect(artifacts.secrets).not.toHaveProperty("SUPPLY_CHAIN_SIGNING_PUBLIC_KEY");
  expect(artifacts.config.vars).not.toHaveProperty("SUPPLY_CHAIN_SIGNING_KEY_ID");
  expect(artifacts.secrets).not.toHaveProperty("S3_ACCESS_KEY_ID");
  expect(artifacts.config.vars).not.toHaveProperty("S3_BUCKET");
  expect(()=>buildStagingArtifacts({...config,routes:[{pattern:"*"}]},process.env,"a".repeat(32))).toThrow(/routes/);
  expect(()=>buildStagingArtifacts({...config,env:{staging:{}}},process.env,"a".repeat(32))).toThrow(/environments/);
  expect(()=>buildStagingArtifacts({...config,observability:{enabled:true,redact_query_string:false}},process.env,"a".repeat(32))).toThrow(/logs enabled and redact/);
  expect(()=>buildStagingArtifacts({...config,observability:{enabled:true,logs:{enabled:false},redact_query_string:true}},process.env,"a".repeat(32))).toThrow(/logs enabled and redact/);
  expect(()=>buildStagingArtifacts({...config,vars:{DATABASE_URL:"leak"}},process.env,"a".repeat(32))).toThrow();
 });
 it("probes only the approved Upstash REST ping without exposing credentials",async()=>{
  const {verifyUpstashRedis}=await import("../scripts/deploy-staging.mjs");
  process.env.UPSTASH_REDIS_REST_URL="https://bke-test.upstash.io/";
  process.env.UPSTASH_REDIS_REST_TOKEN="redis-secret";
  process.env.CLOUDFLARE_API_TOKEN="cloudflare-secret";
  const calls: Array<{input: RequestInfo | URL; init?: RequestInit}> = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({input,init});
    return new Response(JSON.stringify({result:"PONG"}),{status:200});
  };
  const result=await verifyUpstashRedis(process.env,fetcher);
  expect(result).toEqual({code:"PONG",httpStatus:200,pong:true});
  expect(calls).toHaveLength(1);
  const request=calls.at(0);
  expect(request).toBeDefined();
  if (!request) throw new Error("Missing captured Staging Redis request");
  expect(new URL(request.input instanceof Request ? request.input.url : String(request.input)).href).toBe("https://bke-test.upstash.io/ping");
  expect(request.init?.method).toBe("GET");
  expect(request.init?.credentials).toBe("omit");
  expect(request.init?.redirect).toBe("manual");
  const headers=new Headers(request.init?.headers);
  expect(headers.get("authorization")).toBe("Bearer redis-secret");
  expect([...headers.keys()].sort()).toEqual(["accept","authorization"]);
  expect(JSON.stringify(result)).not.toContain("secret");

  for(const [status,code] of [[401,"AUTH_UNAUTHORIZED"],[403,"AUTH_FORBIDDEN"],[302,"REDIRECT_BLOCKED"]] as const){
   let callsMade=0;
   const responseFetch: typeof fetch = async()=>{callsMade++;return new Response("sensitive body",{status});};
   const outcome=await verifyUpstashRedis(process.env,responseFetch);
   expect(outcome.code).toBe(code);
   expect(outcome.httpStatus).toBe(status);
   expect(callsMade).toBe(1);
  }
 });
 it("rejects unsafe endpoints and bounds/sanitizes Upstash responses and transport errors",async()=>{
  const {verifyUpstashRedis}=await import("../scripts/deploy-staging.mjs");
  process.env.UPSTASH_REDIS_REST_TOKEN="redis-secret";
  let calls=0;
  const fetcher: typeof fetch = async()=>{calls++;return new Response("{}");};
  for(const url of [
   "http://bke-test.upstash.io","https://upstash.io","https://bke-test.evilupstash.io",
   "https://user@bke-test.upstash.io","https://bke-test.upstash.io:444",
   "https://bke-test.upstash.io/path","https://bke-test.upstash.io/?token=x",
   "https://bke-test.upstash.io/#fragment","https://bke-test.upstash.io?","https://bke-test.upstash.io#",
   "https://@bke-test.upstash.io",
  ]){
   process.env.UPSTASH_REDIS_REST_URL=url;
   expect((await verifyUpstashRedis(process.env,fetcher)).code).toBe("INVALID_URL");
  }
  expect(calls).toBe(0);
  process.env.UPSTASH_REDIS_REST_URL="https://bke-test.upstash.io";
  expect((await verifyUpstashRedis(process.env,async()=>new Response("not-json"))).code).toBe("INVALID_RESPONSE");
  expect((await verifyUpstashRedis(process.env,async()=>new Response("x".repeat(4097)))).code).toBe("BODY_TOO_LARGE");
  const failed=await verifyUpstashRedis(process.env,async()=>{throw new TypeError("redis-secret cloudflare-secret https://private");});
  expect(failed).toEqual({code:"NETWORK_ERROR",httpStatus:null,pong:false});
  expect(JSON.stringify(failed)).not.toMatch(/secret|private|cloudflare/i);
 });
});
