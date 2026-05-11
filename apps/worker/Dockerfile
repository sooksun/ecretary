FROM node:20-alpine AS base
WORKDIR /repo
RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api/prisma ./apps/api/prisma
COPY apps/worker ./apps/worker

# Hack: worker uses @prisma/client; we need it generated against api schema
COPY apps/api/package.json ./apps/api/package.json

RUN npm install --workspaces --include-workspace-root --no-audit --no-fund
RUN npm --workspace @msec/shared run build
RUN npm --workspace @msec/api exec -- prisma generate --schema=apps/api/prisma/schema.prisma
RUN npm --workspace @msec/worker run build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production

COPY --from=base /repo/node_modules ./node_modules
COPY --from=base /repo/packages/shared ./packages/shared
COPY --from=base /repo/apps/worker/dist ./dist
COPY --from=base /repo/apps/worker/package.json ./package.json

CMD ["node", "dist/main.js"]
