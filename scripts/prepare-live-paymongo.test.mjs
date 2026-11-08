import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertLiveSettings, assertProductionSchemaSettings, buildLiveArtifacts, verifyLiveHyperdrive, LIVE_ORIGIN } from "./prepare-live-paymongo.mjs";
import { assertPublishedCommercialLegal, requiredCommercialDocumentTypes } from "./verify-live-legal.mjs";
import { readFileSync } from "node:fs";

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

it("pins protected GitHub Production to the actual Infisical prod slug",()=>{
  const workflow=readFileSync(new URL("../.github/workflows/live-paymongo-cutover.yml",import.meta.url),"utf8");
  assert.match(workflow,/^\s+environment:\s*\n\s+name: Production\s*$/m);
  assert.match(workflow,/^\s+env-slug: prod\s*$/m);
  assert.doesNotMatch(workflow,/^\s+env-slug: production\s*$/m);
  assert.match(workflow,/^\s+secret-path: \/\s*$/m);
  assert.ok(workflow.includes("project-id: " + "$" + "{{ vars.INFISICAL_PRODUCTION_PROJECT_ID }}"));
});

describe("fresh Production schema preparation — payments and public deployment remain locked",()=>{
  const schemaOnly={
    APP_URL:LIVE_ORIGIN,
    DEPLOYMENT_ENV:"production",
    PRODUCTION_NEON_HOST:host,
    DATABASE_URL:url,
    DIRECT_DATABASE_URL:url,
    HYPERDRIVE_ID:realId,
    // Intentionally NO live PayMongo, Google OAuth, Redis, storage or signing keys.
  };

  it("accepts only the isolated direct Neon Production target without merchant credentials",()=>{
    assert.equal(assertProductionSchemaSettings(schemaOnly).hostname,host);
    assert.throws(()=>assertLiveSettings(schemaOnly),{message:"LIVE_REQUIRED_DEPLOYMENT_ID"});
    assert.equal(verifyLiveHyperdrive(drive,realId,new URL(url),schemaOnly),true);
  });

  const unsafe=[
    [{DEPLOYMENT_ENV:"staging"},"LIVE_DEPLOYMENT_ENV"],
    [{APP_URL:"https://staging.bkedigitalsolutions.com"},"LIVE_APP_ORIGIN"],
    [{PRODUCTION_NEON_HOST:host.replace("ep-live","ep-staging")},"LIVE_DATABASE_HOST"],
    [{PRODUCTION_NEON_HOST:host+"-pooler"},"LIVE_NEON_HOST"],
    [{DATABASE_URL:url.replace("/bke_production?","/bke_staging?")},"LIVE_DATABASE_NAME"],
    [{DIRECT_DATABASE_URL:url.replace("bke_production_owner","bke_staging_owner")},"LIVE_DATABASE_ROLE"],
    [{DATABASE_URL:url+"&host=malicious.example"},"LIVE_DATABASE_QUERY_OVERRIDE"],
    [{DATABASE_URL:url.replace("?sslmode=require","")},"LIVE_DATABASE_TLS"],
    [{DATABASE_URL:url+"&sslmode=require"},"LIVE_DATABASE_QUERY_OVERRIDE"],
    [{DATABASE_URL:url.replace(":secret@",":other@")},"LIVE_DATABASE_CREDENTIAL_MISMATCH"],
    [{STAGING_NEON_HOST:host},"LIVE_STAGING_RESOURCE_INJECTION"],
  ];

  for (const [patch, code] of unsafe) {
    it("rejects schema target violation: "+Object.keys(patch).join(","),()=>{
      assert.throws(()=>assertProductionSchemaSettings({...schemaOnly,...patch}),{message:code});
    });
  }

  it("requires explicit TLS and cache-disabled origin even for schema preparation",()=>{
    assert.throws(()=>verifyLiveHyperdrive({...drive,mtls:{}},realId,new URL(url),schemaOnly),{message:"LIVE_HYPERDRIVE_TRUST"});
    assert.throws(()=>verifyLiveHyperdrive({...drive,caching:{disabled:false}},realId,new URL(url),schemaOnly),{message:"LIVE_HYPERDRIVE_TRUST"});
    assert.throws(()=>verifyLiveHyperdrive({...drive,origin:{...drive.origin,database:"bke_staging"}},realId,new URL(url),schemaOnly),{message:"LIVE_HYPERDRIVE_DATABASE"});
  });

  it("keeps schema writes behind the existing protected exact-main workflow",()=>{
    const workflow=readFileSync(new URL("../.github/workflows/live-paymongo-cutover.yml",import.meta.url),"utf8");
    assert.match(workflow,/^\s+workflow_dispatch:\s*$/m);
    assert.doesNotMatch(workflow,/^\s+(push|pull_request):\s*$/m);
    assert.match(workflow,/^\s+name: Production\s*$/m);
    assert.match(workflow,/LIVE_SOURCE_SHA_NOT_CURRENT_MAIN/);
    assert.match(workflow,/LIVE_REQUIRED_CERTIFICATION_MISSING/);
    assert.match(workflow,/PREPARE_PRODUCTION_SCHEMA/);
    assert.match(workflow,/node scripts\/prepare-live-paymongo\.mjs validate_schema/);
    assert.match(workflow,/node scripts\/prepare-live-paymongo\.mjs verify_schema/);
    assert.match(workflow,/^\s+if: \x24\{\{ inputs\.mode == 'prepare_database' \}\}\s*$/m);
    assert.match(workflow,/^\s+if: \x24\{\{ inputs\.mode != 'prepare_database' \}\}\s*$/m);
    assert.match(workflow,/^\s+run: npm run db:status\s*$/m);
    assert.match(workflow,/^\s+npm run db:deploy\s*$/m);
    assert.match(workflow,/^\s+if: \x24\{\{ inputs\.mode == 'deploy_live' \}\}\s*$/m);
    assert.match(workflow,/^\s+env-slug: prod\s*$/m);
  });
});

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
   [{DIRECT_DATABASE_URL:url.replace("/bke_production?","/bke_staging?")},"LIVE_DATABASE_NAME"],
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

describe("protected production schema and legal release boundaries", () => {
  const instant = new Date("2026-11-08T00:00:00Z");
  const published = requiredCommercialDocumentTypes.map((type) => ({
    type,
    title: type.replaceAll("_", " "),
    docStatus: "ACTIVE",
    versionStatus: "PUBLISHED",
    publishedAt: new Date("2026-11-01T00:00:00Z"),
    effectiveAt: new Date("2026-11-01T00:00:00Z"),
    contentHash: "a".repeat(64),
    markdownContent: "Approved commercial terms: subject to actual human/legal review.",
    renderedHtml: "<p>Approved commercial terms</p>",
  }));
  it("requires all five published non-test commercial notices", () => {
    assert.equal(requiredCommercialDocumentTypes.length, 5);
    assert.equal(assertPublishedCommercialLegal(published, instant), true);
  });
  for (const [name, edit] of [
    ["missing document", (a) => a.slice(1)],
    ["duplicate document", (a) => [...a, a[0]]],
    ["draft publication", (a) => a.map((r,i) => i ? r : {...r,versionStatus:"DRAFT"})],
    ["missing publication time", (a) => a.map((r,i) => i ? r : {...r,publishedAt:null})],
    ["future effective date", (a) => a.map((r,i) => i ? r : {...r,effectiveAt:"2030-01-01T00:00:00Z"})],
    ["missing legal content hash", (a) => a.map((r,i) => i ? r : {...r,contentHash:""})],
    ["noncommercial mock notice", (a) => a.map((r,i) => i ? r : {...r,markdownContent:"Noncommercial mock checkout TEST-ONLY"})],
    ["review draft title", (a) => a.map((r,i) => i ? r : {...r,title:"REVIEW DRAFT"})],
  ]) {
    it("fails closed on "+name, () => {
      assert.throws(() => assertPublishedCommercialLegal(edit(published), instant), { message: "LIVE_LEGAL_APPROVAL_REQUIRED" });
    });
  }
  it("requires explicit schema authorization and keeps all production modes manual and main-only", () => {
    const workflow = readFileSync(".github/workflows/live-paymongo-cutover.yml", "utf8");
    assert.ok(workflow.includes("PREPARE_PRODUCTION_SCHEMA"));
    assert.ok(workflow.includes("ENABLE_REAL_PAYMONGO_CHARGES"));
    assert.ok(workflow.includes("LIVE_DATABASE_PREPARATION_AUTHORIZATION_REQUIRED"));
    assert.ok(workflow.includes("github.ref == 'refs/heads/main'"));
    assert.ok(workflow.includes("node scripts/verify-live-legal.mjs"));
    assert.ok(workflow.includes("npm run db:deploy"));
    assert.ok(workflow.includes("if: ${{ inputs.mode == 'prepare_database' }}"));
    assert.ok(workflow.includes("if: ${{ inputs.mode == 'deploy_live' }}"));
    assert.ok(!/^  (?:push|pull_request):/m.test(workflow));
  });
});
