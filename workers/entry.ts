// @ts-expect-error OpenNext generates this JavaScript module during workers:build.
import handler from "../.open-next/worker.js";
import { withOperationResponse } from "../platform/host/operation-scope";

export default {
  async fetch(request, env, ctx) {
    const databaseUrl = env.HYPERDRIVE_FRESH?.connectionString;
    if (!databaseUrl) {
      return new Response("Service unavailable", { status: 503 });
    }
    return withOperationResponse(databaseUrl, async (track) => {
      const context = new Proxy(ctx, {
        get(target, property) {
          if (property === "waitUntil") {
            return (promise: Promise<unknown>) => {
              track(promise);
              target.waitUntil(promise);
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return handler.fetch(request, env, context);
    }, (promise) => ctx.waitUntil(promise));
  },
} satisfies ExportedHandler<CloudflareEnv>;
