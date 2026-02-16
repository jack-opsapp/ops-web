import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.amazonaws.com",
        pathname: "/ops-app-files-prod/**",
      },
      {
        protocol: "https",
        hostname: "*.bubbleapps.io",
        pathname: "/**",
      },
    ],
  },
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "date-fns",
    ],
  },
  // Proxy Bubble API calls through Next.js to avoid CORS issues.
  // Browser requests /api/bubble/* (same origin) → Next.js forwards to Bubble (server-side).
  async rewrites() {
    return [
      {
        source: "/api/bubble/:path*",
        destination: "https://opsapp.co/version-test/api/1.1/:path*",
      },
    ];
  },
};

export default nextConfig;
