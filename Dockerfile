# syntax=docker/dockerfile:1.7
FROM node:22.18-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
COPY . .
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run db:generate
RUN NODE_ENV=production DEPLOYMENT_ENV=development APP_URL=http://localhost:3000 DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build SESSION_SECRET=build-only-session-secret-32-characters LICENSE_PEPPER=build-only-license-pepper-32-characters CRON_SECRET=build-only-cron-secret-32-characters EMAIL_FROM=build@example.com S3_BUCKET=build-private npm run build

FROM dependencies AS migrations
RUN addgroup --system --gid 1002 prisma && adduser --system --uid 1002 prisma
COPY --chown=prisma:prisma prisma ./prisma
COPY --chown=prisma:prisma prisma.config.ts ./prisma.config.ts
COPY --chown=prisma:prisma generated ./generated
ENV NODE_ENV=production
USER prisma
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:22.18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN apk add --no-cache libc6-compat openssl && addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
