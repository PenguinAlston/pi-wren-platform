#!/bin/sh
# Next.js standalone 的 rewrites 在构建期固化进 routes-manifest.json，
# 运行时环境变量不生效。容器启动时按 NEXT_PUBLIC_API_URL 重写代理目标。
set -e
API_URL="${NEXT_PUBLIC_API_URL:-http://backend:8080}"
MANIFEST="/app/apps/web/.next/routes-manifest.json"
if [ -f "$MANIFEST" ] && [ "$API_URL" != "http://localhost:8080" ]; then
  sed -i "s|http://localhost:8080|$API_URL|g" "$MANIFEST"
fi
exec "$@"
