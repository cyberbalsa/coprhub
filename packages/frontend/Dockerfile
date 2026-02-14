FROM docker.io/oven/bun:1 AS base

FROM base AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/frontend/package.json packages/frontend/
COPY packages/sync/package.json packages/sync/
RUN bun install --frozen-lockfile
COPY packages/shared/ packages/shared/
COPY packages/frontend/ packages/frontend/
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run --cwd packages/frontend next build

FROM docker.io/node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /app/packages/frontend/.next/standalone ./
COPY --from=build /app/packages/frontend/.next/static ./packages/frontend/.next/static
COPY --from=build /app/packages/frontend/public ./packages/frontend/public
EXPOSE 3000
ENV PORT=3000
CMD ["node", "packages/frontend/server.js"]
