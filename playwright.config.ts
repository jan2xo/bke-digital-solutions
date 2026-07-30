import "dotenv/config";
import { defineConfig } from "@playwright/test";
export default defineConfig({testDir:"tests/e2e",workers:1,fullyParallel:false,use:{baseURL:"http://127.0.0.1:3000",trace:"on-first-retry"},webServer:{command:"/tmp/bke-node-runtime/bin/npm run dev",url:"http://127.0.0.1:3000",reuseExistingServer:false,stdout:"pipe",stderr:"pipe",timeout:120000}});
