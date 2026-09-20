import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/**/*.test.ts",
      "contracts/**/*.test.ts",
      "modules/**/*.test.ts",
      "platform/**/*.test.ts",
      "tooling/**/*.test.ts",
    ],
    fileParallelism: false,
  },
});
