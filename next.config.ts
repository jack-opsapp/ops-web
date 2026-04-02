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
        hostname: "ops-app-files-prod.s3.us-west-2.amazonaws.com",
        pathname: "/shop/**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
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
};

export default nextConfig;
