import "dotenv/config";
import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "tests/e2e", outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "/tmp/test-results", workers: 1, fullyParallel: false, use: { baseURL: "https://caddy", ignoreHTTPSErrors: true, trace: "on-first-retry", launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } }, timeout: 120000 });
