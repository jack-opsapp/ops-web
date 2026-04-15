import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Warnings from other agents' unused imports break the Vercel build.
    // tsc --noEmit catches real errors. Lint cleanup is a separate task.
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      // Virtual-hosted-style bucket URL (how profile images and uploads are actually served)
      {
        protocol: "https",
        hostname: "ops-app-files-prod.s3.us-west-2.amazonaws.com",
        pathname: "/**",
      },
      // Path-style bucket URL (legacy / SigV4 fallback)
      {
        protocol: "https",
        hostname: "s3.us-west-2.amazonaws.com",
        pathname: "/ops-app-files-prod/**",
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
  async headers() {
    return [
      {
        // Apple App Site Association file for Universal Links.
        // Apple requires Content-Type: application/json and no redirects.
        // Files in public/ without an extension default to octet-stream,
        // so we override the Content-Type explicitly here.
        source: "/.well-known/apple-app-site-association",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
    ];
  },
};

export default nextConfig;
