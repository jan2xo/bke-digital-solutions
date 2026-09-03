import type { NextConfig } from "next";

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
  ],
};

export default nextConfig;
