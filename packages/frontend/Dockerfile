FROM oven/bun:1 AS base

FROM base AS deps
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/frontend/package.json packages/frontend/
RUN bun install --frozen-lockfile

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app ./
COPY packages/shared/ packages/shared/
COPY packages/frontend/ packages/frontend/
RUN npx --yes next build packages/frontend

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /app/packages/frontend/.next/standalone ./
COPY --from=build /app/packages/frontend/.next/static ./packages/frontend/.next/static
COPY --from=build /app/packages/frontend/public ./packages/frontend/public 2>/dev/null || true
EXPOSE 3000
ENV PORT=3000
CMD ["node", "packages/frontend/server.js"]
