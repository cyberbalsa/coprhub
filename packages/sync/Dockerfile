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
COPY packages/sync/ packages/sync/

FROM base AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client gzip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app ./
CMD ["bun", "run", "packages/sync/src/index.ts"]
