FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY src ./src
COPY protocol ./protocol
ENV PI_DATA_DIR=/app/data/sessions
VOLUME ["/app/data"]
EXPOSE 8090
CMD ["node", "src/server.mjs"]
