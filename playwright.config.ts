import "dotenv/config";
import { defineConfig } from "@playwright/test";
export default defineConfig({testDir:"tests/e2e",outputDir:process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",workers:1,fullyParallel:false,use:{baseURL:"http://127.0.0.1:3000",trace:"on-first-retry",launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}},webServer:{command:"BKE_DISABLE_EXTERNAL_EMAIL=true npm run dev",url:"http://127.0.0.1:3000",reuseExistingServer:process.env.PLAYWRIGHT_REUSE_SERVER==="true",stdout:"pipe",stderr:"pipe",timeout:120000}});
