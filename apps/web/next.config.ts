import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
