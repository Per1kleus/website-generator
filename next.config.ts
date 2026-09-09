import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 and sharp are native modules: keep them external to the
  // server bundle so Next never tries to trace/bundle their .node binaries.
  serverExternalPackages: ["better-sqlite3", "sharp", "archiver"],
  // The ui-ux-pro-max catalogue is read from disk at request time, so a
  // standalone build has to carry it along with the server bundle.
  outputFileTracingIncludes: {
    "/api/**": ["./vendor/ui-ux-pro-max/**"],
  },
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
