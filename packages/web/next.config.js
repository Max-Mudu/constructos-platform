/** @type {import('next').NextConfig} */
const nextConfig = {
  // Proxy all /api/v1/* requests to the backend API.
  // This means cookies (refreshToken) are set on localhost:3000 and
  // are readable by Next.js middleware for route protection.
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
