# syntax=docker/dockerfile:1.6
#
# Cloud Run PDF renderer — Puppeteer + headless Chromium.
# Multi-stage build: builder installs all deps + builds bundle, runtime image
# only carries the bundled JS, prod deps, and Chromium.

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.30.2

# ----- Builder ----------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS builder
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Copy workspace manifests first so dep install caches well.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/pdf-renderer/package.json ./apps/pdf-renderer/

RUN pnpm install --frozen-lockfile --filter @ops/pdf-renderer...

# Copy sources and build.
COPY packages/shared ./packages/shared
COPY apps/pdf-renderer ./apps/pdf-renderer
COPY tsconfig.base.json ./

RUN pnpm --filter @ops/pdf-renderer build

# Produce a self-contained deploy directory (prod deps only, workspace deps
# resolved into node_modules).
RUN pnpm deploy --filter @ops/pdf-renderer --prod /deploy

# ----- Runtime ---------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

# Chromium runtime deps (Puppeteer downloads its own Chromium binary).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
      libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libdrm2 libexpat1 \
      libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
      libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
      libxkbcommon0 libxrandr2 wget xdg-utils \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

COPY --from=builder /deploy /app

# Ensure Puppeteer's Chromium is downloaded into the runtime layer.
RUN node -e "import('puppeteer').then(p => p.default.executablePath ? null : null)" \
    && npx --no-install puppeteer browsers install chrome

EXPOSE 8080
CMD ["node", "lib/index.js"]
