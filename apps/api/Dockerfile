# API image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t mb-api .
# Runs as a non-root user; secrets come from the environment at run time, never from the image.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @mb/api --include-workspace-root=false
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @mb/api

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# Production dependencies only (express, mongoose, argon2, ...). @mb/shared is bundled into dist.
RUN npm ci --omit=dev --workspace @mb/api --include-workspace-root=false && npm cache clean --force
COPY --from=build /repo/apps/api/dist apps/api/dist
WORKDIR /repo/apps/api
USER node
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run `node dist/scripts/bootstrap.js` once per release before switching traffic (see docs/DEPLOYMENT.md).
CMD ["node", "--enable-source-maps", "dist/server.js"]
