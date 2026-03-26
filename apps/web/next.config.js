/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_URL ?? 'http://localhost:3000';

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@qa/shared'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? '/api/v1',
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${API_ORIGIN}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
