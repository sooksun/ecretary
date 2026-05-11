FROM node:20-alpine AS base
WORKDIR /repo
RUN apk add --no-cache openssl

# install deps for the entire workspace (api + shared)
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN npm install --workspaces --include-workspace-root --no-audit --no-fund

# Generate Prisma client + build TS
RUN npm --workspace @msec/shared run build
RUN npm --workspace @msec/api exec -- prisma generate
RUN npm --workspace @msec/api run build

# ── runtime ───────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production

COPY --from=base /repo/node_modules ./node_modules
COPY --from=base /repo/packages/shared ./packages/shared
COPY --from=base /repo/apps/api/dist ./dist
COPY --from=base /repo/apps/api/node_modules ./node_modules_local
COPY --from=base /repo/apps/api/prisma ./prisma
COPY --from=base /repo/apps/api/package.json ./package.json
# M6: bundled Sarabun fonts for PDF export (process.cwd() resolves to /app)
COPY --from=base /repo/apps/api/assets ./assets

EXPOSE 3000
# Apply pending Prisma migrations on container start, then boot Nest.
# Use `migrate deploy` (idempotent, no schema-drift checks) — never `migrate dev` in prod.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
