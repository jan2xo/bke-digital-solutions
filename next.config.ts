import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: [
    "@bke/identity",
    "@bke/accounts",
    "@bke/legal",
    "@bke/catalog",
    "@bke/commerce",
    "@bke/licensing",
    "@bke/entitlements",
    "@bke/payments",
    "@bke/notifications",
    "@bke/support",
    "@bke/privacy",
    "@bke/trials",
  ],
};

if (process.env.BKE_WORKERS_BUILD === "1") {
  nextConfig.webpack = (config, { isServer }) => {
    if (isServer) {
      if (!Array.isArray(config.externals)) throw new Error("Unexpected Next server externals");
      const compilerDirectory = resolve("platform/persistence/generated/prisma/internal");
      const compilerArtifact = resolve(".workers-build/prisma-query-compiler.wasm") + "?module";
      // OpenNext preserves WASM imports for Wrangler's precompiled module loader.
      // Only this generated PostgreSQL compiler crosses that build boundary.
      config.externals.unshift((
        { context, request }: { context?: string; request?: string },
        callback: (error: Error | null, value?: string) => void,
      ) => {
        if (context === compilerDirectory && request === "./query_compiler_fast_bg.wasm?module") {
          return callback(null, "commonjs " + compilerArtifact);
        }
        callback(null);
      });
    }
    return config;
  };
}

export default nextConfig;
