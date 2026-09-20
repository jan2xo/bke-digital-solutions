import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({test:{environment:"node",include:["tests/**/*.test.ts"],fileParallelism:false,coverage:{reporter:["text","json"]}},resolve:{alias:{"@":fileURLToPath(new URL("./",import.meta.url)),"server-only":fileURLToPath(new URL("./tests/server-only.ts",import.meta.url))}}});
