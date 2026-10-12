FROM node:24.13.1-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile
COPY . .
ARG VITE_API_URL
ARG VITE_SUPPORT_EMAIL
ENV VITE_API_URL=$VITE_API_URL VITE_SUPPORT_EMAIL=$VITE_SUPPORT_EMAIL
RUN pnpm build

FROM node:24.13.1-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Preserve workspace symlinks and the exact locked dependency graph for all three apps.
COPY --from=build --chown=node:node /app /app
USER node
CMD ["node", "apps/api/dist/main.js"]
