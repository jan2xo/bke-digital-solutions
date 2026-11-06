// @ts-expect-error OpenNext generates this JavaScript module during workers:build.
import handler from "../.open-next/worker.js";
import { operationResource, withOperationResponse } from "../platform/host/operation-scope";
import { CLOUDFLARE_EMAIL_SEND_RESOURCE, type CloudflareEmailSend } from "../platform/email/cloudflare-provider";
import { parseEmailSender } from "../platform/email/sender";

export default {
  async fetch(request, env, ctx) {
    const databaseUrl = env.HYPERDRIVE_FRESH?.connectionString;
    if (!databaseUrl) {
      return new Response("Service unavailable", { status: 503 });
    }
    return withOperationResponse(databaseUrl, async (track) => {
      const sender = parseEmailSender(Reflect.get(env, "EMAIL_FROM"));
      if (env.EMAIL && sender) {
        operationResource<CloudflareEmailSend>(CLOUDFLARE_EMAIL_SEND_RESOURCE, () => async (message) => {
          const pending = env.EMAIL.send({
            to: message.to,
            from: sender.name ? { email: sender.email, name: sender.name } : sender.email,
            subject: message.subject,
            text: message.text,
            html: "<p>" + message.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")
              .replace(/\n/g, "<br>") + "</p>",
          });
          // The caller awaits a bounded deadline. Do not add the raw, possibly
          // never-settling RPC to response-scope cleanup/background tracking.
          return pending;
        });
      }
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
