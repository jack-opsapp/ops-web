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
  // Bubble API calls are proxied through /api/bubble/[...path] API route.
  // The API route sets the Authorization header server-side (more reliable than rewrites).
};

export default nextConfig;
