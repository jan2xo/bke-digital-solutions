import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { probeStagingPayMongoLive } from "./probe-staging-paymongo.mjs";

const valid = {
  APP_URL: "https://bkedigitalsolutions.com",
  DEPLOYMENT_ENV: "staging",
  PAYMENT_PROVIDER: "mock", PAYMONGO_LIVEMODE: "false",
  PAYMONGO_SECRET_KEY: "sk_live_" + "a".repeat(24),
  PAYMONGO_WEBHOOK_SECRET: "whsec_" + "b".repeat(32),
};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}});
describe("isolated Staging live PayMongo credential probe",()=>{
  it("authenticates live key through only the published, read-only capabilities API", async()=>{
    let called=0;
    const result=await probeStagingPayMongoLive(valid,async (url,opts)=>{
      called++;
      assert.equal(url,"https://api.paymongo.com/v1/merchants/capabilities/payment_methods");
      assert.equal(opts.method,"GET");
      assert.equal(opts.redirect,"error");
      assert.equal(opts.cache,"no-store");
      assert.equal(new Headers(opts.headers).get("authorization"),
        "Basic "+Buffer.from(valid.PAYMONGO_SECRET_KEY+":").toString("base64"));
      assert.ok(!("body" in opts));
      return response(["qrph","card"]);
    });
    assert.equal(called,1);
    assert.deepEqual(result,{status:"PASS",code:"LIVE_KEY_AUTHENTICATED_QRPH_ENABLED"});
  });
  it("accepts PayMongo's nested data array when returned",async()=>{
    const result=await probeStagingPayMongoLive(valid,async()=>response({data:["qrph"]}));
    assert.equal(result.status,"PASS");
  });
  it("distinguishes a live key from staging mock runtime flags",async()=>{
    const result=await probeStagingPayMongoLive({...valid,PAYMENT_PROVIDER:"mock",PAYMONGO_LIVEMODE:"false"},async()=>response(["qrph"]));
    assert.equal(result.status,"PASS");
  });
  it("never uses a test key or missing signing secret",async()=>{
    let called=0;
    const spy=async()=>{called++;throw Error("unexpected network");};
    await assert.rejects(()=>probeStagingPayMongoLive({...valid,PAYMONGO_SECRET_KEY:"sk_test_private"},spy),{message:"PAYMONGO_LIVE_KEY_REQUIRED"});
    await assert.rejects(()=>probeStagingPayMongoLive({...valid,PAYMONGO_WEBHOOK_SECRET:""},spy),{message:"PAYMONGO_LIVE_WEBHOOK_SECRET_MISSING"});
    assert.equal(called,0);
  });
  it("never silently claims success when a Staging key is missing",async()=>{
    const result=await probeStagingPayMongoLive({...valid,PAYMONGO_SECRET_KEY:""},async()=>{throw Error("network forbidden")});
    assert.deepEqual(result,{status:"SKIPPED",code:"NO_PAYMONGO_SECRET_IN_STAGING"});
  });
  it("rejects wrong origin and production database scope",async()=>{
    let called=0;
    const f=async()=>{called++;throw Error("network forbidden");};
    await assert.rejects(()=>probeStagingPayMongoLive({...valid,APP_URL:"https://another.example"},f),{message:"PAYMONGO_PROBE_ORIGIN_MISMATCH"});
    await assert.rejects(()=>probeStagingPayMongoLive({...valid,DEPLOYMENT_ENV:"production"},f),{message:"PAYMONGO_PROBE_STAGING_ONLY"});
    assert.equal(called,0);
  });
  it("distinguishes refused keys and PayMongo errors without leaking response",async()=>{
    await assert.rejects(()=>probeStagingPayMongoLive(valid,async()=>response({secret:"sk_live_dont_print"},401)),{message:"PAYMONGO_LIVE_KEY_REJECTED"});
    await assert.rejects(()=>probeStagingPayMongoLive(valid,async()=>response({secret:"sk_live_dont_print"},500)),{message:"PAYMONGO_CAPABILITIES_HTTP_500"});
    await assert.rejects(()=>probeStagingPayMongoLive(valid,async()=>{throw Error("real secrets are hidden")}),{message:"PAYMONGO_CAPABILITIES_NETWORK_FAILURE"});
  });
  it("reports QR Ph capability missing without claiming session creation",async()=>{
    const result=await probeStagingPayMongoLive(valid,async()=>response(["card","gcash"]));
    assert.deepEqual(result,{status:"FAILED",code:"PAYMONGO_QRPH_NOT_ENABLED"});
  });
  it("rejects response format anomalies or oversized bodies",async()=>{
    await assert.rejects(()=>probeStagingPayMongoLive(valid,async()=>response({secret:"ignore"})),{message:"PAYMONGO_CAPABILITIES_FORMAT_UNRECOGNIZED"});
    await assert.rejects(()=>probeStagingPayMongoLive(valid,async()=>new Response("X".repeat(65_537),{status:200})),{message:"PAYMONGO_CAPABILITIES_INVALID_RESPONSE"});
  });
});
