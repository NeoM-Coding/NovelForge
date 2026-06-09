# syntax=docker/dockerfile:1
# ============================================================
# NovelForge Production Dockerfile
# Optimized with BuildKit cache mounts for faster rebuilds
# ============================================================

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# 1. Install dependencies — cached when package.json unchanged
#    BuildKit cache mount speeds up npm ci by reusing ~/.npm
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --legacy-peer-deps

# 2. Copy source (filtered by .dockerignore — no node_modules, .git, uploads, docs)
COPY . .

# 3. Build frontend (Vite) — cache Vite's internal cache
RUN --mount=type=cache,target=/app/node_modules/.vite \
    npm run build

# 4. Compile backend TypeScript — cache tsc incremental builds
RUN --mount=type=cache,target=/app/.tsbuildinfo \
    npx tsc -b tsconfig.server.json

# Production stage — only runtime files, no build tools
FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/loader.mjs ./loader.mjs

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "--experimental-loader", "./loader.mjs", "dist/api/server.js"]
