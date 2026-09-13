FROM node:22-alpine
# 国内构建换源：NPM_REGISTRY=https://registry.npmmirror.com（默认即 npmmirror）
ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV npm_config_registry=${NPM_REGISTRY}
ENV COREPACK_NPM_REGISTRY=${NPM_REGISTRY}
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# dev 依赖（vitest/ajv/types）一并安装：体积可接受且保测试能力
RUN pnpm install --frozen-lockfile
COPY src ./src
COPY protocol ./protocol
ENV PI_DATA_DIR=/app/data/sessions
VOLUME ["/app/data"]
EXPOSE 8090
CMD ["node", "src/server.mjs"]
