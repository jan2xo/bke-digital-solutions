import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No remote cache or new storage authority. Authenticated data remains dynamic.
export default defineCloudflareConfig({});
