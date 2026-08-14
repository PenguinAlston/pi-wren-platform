# apps/web 生产镜像（构建上下文 = frontend/，pnpm workspace 根）
#   docker build -f apps/web/Dockerfile -t piwren-web frontend/
# 基础镜像可换国内源：--build-arg NODE_IMAGE=docker.1ms.run/library/node:22-alpine
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS builder
# 容器内依赖下载走国内源（corepack 拉 pnpm 与 pnpm install 共用；海外构建覆盖为 https://registry.npmjs.org）
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
WORKDIR /ws

# 先装依赖（层缓存：源码改动不重装）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --registry=${NPM_REGISTRY}

COPY packages/shared-types packages/shared-types
COPY tsconfig.base.json eslint.config.mjs ./
COPY apps/web apps/web
RUN pnpm --filter @pi-wren/web build

# --- 运行层：仅 standalone 产物 ---
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# 后端地址在容器启动时经 entrypoint 注入（rewrites 构建期固化，启动时补丁 manifest）
ENV NEXT_PUBLIC_API_URL=http://backend:8080
COPY --from=builder /ws/apps/web/.next/standalone ./
COPY --from=builder /ws/apps/web/.next/static ./apps/web/.next/static
COPY apps/web/docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "apps/web/server.js"]
