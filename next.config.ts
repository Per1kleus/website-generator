import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 and sharp are native modules: keep them external to the
  // server bundle so Next never tries to trace/bundle their .node binaries.
  serverExternalPackages: ["better-sqlite3", "sharp", "archiver"],
  experimental: {
    // Ship less JS to phones: only the icons actually imported get bundled.
    optimizePackageImports: ["@/components/icons"],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
