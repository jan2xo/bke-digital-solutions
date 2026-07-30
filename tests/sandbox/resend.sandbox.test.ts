import "dotenv/config";
import { describe,expect,it } from "vitest";
const configured=Boolean(process.env.RESEND_API_KEY&&process.env.RESEND_SANDBOX_TO);
describe("Resend delivery sandbox",()=>{it.skipIf(!configured)("delivers through the configured provider abstraction",async()=>{const{emailProvider}=await import("@/lib/email");await expect(emailProvider.send({to:process.env.RESEND_SANDBOX_TO!,subject:"BKE Digital Solutions sandbox delivery verification",text:"This confirms the configured BKE transactional email transport can deliver."})).resolves.toBeUndefined()})});
