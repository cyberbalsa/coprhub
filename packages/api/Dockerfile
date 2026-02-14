FROM oven/bun:1 AS base

FROM base AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
RUN bun install --frozen-lockfile
COPY packages/shared/ packages/shared/
COPY packages/api/ packages/api/

FROM base AS runtime
WORKDIR /app
COPY --from=build /app ./
EXPOSE 4000
CMD ["bun", "run", "packages/api/src/index.ts"]
