import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "tests/e2e", workers: 1, fullyParallel: false, use: { baseURL: "http://jl-bke.localhost:8080", trace: "on-first-retry" } });
