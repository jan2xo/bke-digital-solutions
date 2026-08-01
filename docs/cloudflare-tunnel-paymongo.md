# Temporary Cloudflare tunnel for PayMongo sandbox

The official root domain must not point to a development laptop. Cloudflare is authoritative DNS; Namecheap is only the registrar.

1. Start the local certification stack and confirm `https://jl-bke.localhost:8443/api/health/ready`.
2. Install/authenticate `cloudflared` using the owner's Cloudflare account, or use a disposable quick tunnel.
3. Expose only local Caddy:

   ```bash
   cloudflared tunnel --url https://localhost:8443 --no-tls-verify
   ```

4. Copy only the generated HTTPS origin into ignored `.env.certification` as `PUBLIC_WEBHOOK_ORIGIN`. Do not change `APP_URL`; browser redirects remain on the canonical local origin.
5. Register `${PUBLIC_WEBHOOK_ORIGIN}/api/webhooks/paymongo` in the PayMongo test dashboard and place its test webhook secret in the ignored file.
6. Restart the app, complete sandbox transactions, and record only IDs/statuses—not signatures or payloads.
7. Stop `cloudflared`, then disable/delete the temporary PayMongo webhook endpoint.

The tunnel must never expose PostgreSQL, Valkey, MinIO, its console, Docker, or the filesystem. A dedicated `webhook-dev.jl-bke.com` may be used later only by an intentional Cloudflare configuration change that preserves Resend DNS records.

