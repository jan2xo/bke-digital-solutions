import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "https://jl-bke.localhost:8443",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
  },
});
