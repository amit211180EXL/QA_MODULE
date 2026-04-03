/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.API_URL ?? 'http://localhost:3000';

/**
 * pnpm workspaces can leave webpack unable to resolve Next’s internal loaders by bare name.
 * Point explicitly at the file inside the resolved `next` package (Windows-friendly).
 */
function patchNextFlightClientEntryLoader(config) {
  try {
    const resolved = require.resolve(
      'next/dist/build/webpack/loaders/next-flight-client-entry-loader'
    );
    config.resolveLoader = config.resolveLoader || {};
    const alias = config.resolveLoader.alias || {};
    config.resolveLoader.alias = {
      ...alias,
      'next-flight-client-entry-loader': resolved,
    };
  } catch {
    // `next` not installed yet (e.g. fresh clone before pnpm install).
  }
}

const nextConfig = {
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,
  transpilePackages: ['@qa/shared'],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? '/api/v1',
  },
  webpack(config) {
    patchNextFlightClientEntryLoader(config);
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${API_ORIGIN}/api/v1/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        // Allow browsers to cache JS/CSS chunks aggressively (they are content-hashed by Next.js).
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
