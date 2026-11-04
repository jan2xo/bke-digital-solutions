import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const keys = ["BKE_RUNTIME","NODE_ENV","DEPLOYMENT_ENV","APP_URL","DATABASE_URL","DIRECT_DATABASE_URL","SESSION_SECRET","LICENSE_PEPPER","CRON_SECRET","S3_BUCKET","EMAIL_FROM"] as const;
const saved = new Map(keys.map((k) => [k, process.env[k]]));
afterEach(() => { for (const k of keys) { const v=saved.get(k); if(v===undefined) delete process.env[k]; else process.env[k]=v; } vi.resetModules(); });
function configure(runtime:"node"|"workers") {
 process.env.BKE_RUNTIME=runtime; process.env.NODE_ENV="test"; process.env.DEPLOYMENT_ENV="test";
 process.env.APP_URL=`https://${runtime}-ci.example.invalid`; process.env.SESSION_SECRET="ci-session-secret-with-at-least-32-chars";
 process.env.LICENSE_PEPPER="ci-license-pepper-with-at-least-32-chars"; process.env.CRON_SECRET="ci-cron-secret-with-at-least-32-chars";
 process.env.S3_BUCKET="ci-private"; process.env.EMAIL_FROM="build@example.invalid";
 delete process.env.DATABASE_URL; delete process.env.DIRECT_DATABASE_URL;
}
describe("host runtime environment scope",()=>{
 it("defers Workers parsing until Hyperdrive is supplied by an operation",async()=>{
  configure("workers"); const {env,getRuntimeEnvironment}=await import("@/platform/host/env");
  expect(()=>env.APP_URL).toThrow("WORKER_OPERATION_SCOPE_REQUIRED");
  const scope=await import("@/platform/host/operation-scope"), pending:Promise<unknown>[]=[];
  const url="postgresql://worker:secret@hyperdrive.invalid:5432/bke_staging";
  const response=await scope.withOperationResponse(url,async()=>{
   expect(env.DATABASE_URL).toBe(url); expect(getRuntimeEnvironment().DATABASE_URL).toBe(url);
   expect(Object.keys(env)).toContain("DATABASE_URL"); expect("APP_URL" in env).toBe(true); return new Response(null);
  },p=>pending.push(p));
  expect(response.status).toBe(200); await Promise.all(pending); expect(()=>env.DATABASE_URL).toThrow("WORKER_OPERATION_SCOPE_REQUIRED");
 });
 it("preserves Node operation override and dynamic getRuntimeEnvironment refresh",async()=>{
  configure("node"); process.env.DATABASE_URL="postgresql://node:secret@localhost:5432/bke_test";
  process.env.APP_URL="https://node-before.example.invalid";
  const {env,getRuntimeEnvironment}=await import("@/platform/host/env");
  expect(env.DATABASE_URL).toBe(process.env.DATABASE_URL); expect(Object.keys(env)).toContain("DATABASE_URL");
  const scope=await import("@/platform/host/operation-scope"), pending:Promise<unknown>[]=[];
  const url="postgresql://operation:secret@localhost:5432/bke_test";
  const response=await scope.withOperationResponse(url,async()=>{
   expect(env.DATABASE_URL).toBe(url); process.env.APP_URL="https://node-after.example.invalid";
   expect(env.APP_URL).toBe("https://node-before.example.invalid"); expect(getRuntimeEnvironment().APP_URL).toBe("https://node-after.example.invalid");
   return new Response(null);
  },p=>pending.push(p));
  expect(response.status).toBe(200); await Promise.all(pending);
 });
});
