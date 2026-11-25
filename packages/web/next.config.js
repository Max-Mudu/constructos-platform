const { apiProxyTarget } = require('./api-proxy-target');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app never uses next/image. Disabling the optimizer removes the
  // /_next/image endpoint and the image-optimizer advisories that affect Next 14.
  images: { unoptimized: true },
  experimental: {
    // Daily report AI extraction and finalise (PDF with photos) can exceed the
    // 30 s default proxy timeout; the client's own timeouts are 60–90 s.
    proxyTimeout: 120_000,
  },
  // Proxy all /api/v1/* requests to the backend API.
  // This means cookies (refreshToken) are set on localhost:3000 and
  // are readable by Next.js middleware for route protection.
  // Target: API_INTERNAL_URL when set, else NEXT_PUBLIC_API_URL (api-proxy-target.js).
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiProxyTarget()}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
