import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", ".open-next/**", ".wrangler/**", ".workers-build/**", "workers/env.d.ts", "coverage/**", "next-env.d.ts"]),
]);
