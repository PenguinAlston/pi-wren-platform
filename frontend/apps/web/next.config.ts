import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 容器化部署用 standalone 产物（.next/standalone）；本地 pnpm build 不受影响
  output: 'standalone',
  experimental: {
    // 上游 LLM 推理较慢，放宽代理超时（默认 30s 会导致 500）
    proxyTimeout: 120_000,
  },
  transpilePackages: ['@pi-wren/shared-types'],
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
