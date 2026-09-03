import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["v2/modules/catalog/test/**/*.test.ts"],
  },
});
