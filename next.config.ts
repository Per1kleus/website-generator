import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 and sharp are native modules: keep them external to the
  // server bundle so Next never tries to trace/bundle their .node binaries.
  /**
   * "standalone" emits a self-contained server under .next/standalone with
   * only the modules it actually needs. That is what the desktop build ships
   * as a sidecar — without it, packaging would mean bundling all of
   * node_modules. It changes nothing for `next start` or a web deployment.
   */
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "sharp", "archiver"],
  // The ui-ux-pro-max catalogue is read from disk at request time, so a
  // standalone build has to carry it along with the server bundle.
  outputFileTracingIncludes: {
    "/api/**": ["./vendor/ui-ux-pro-max/**"],
  },
  // Trace from the repo root so the standalone bundle resolves the native
  // modules and the vendored catalogue correctly.
  outputFileTracingRoot: process.cwd(),
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
