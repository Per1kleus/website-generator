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
  /**
   * What the standalone server must NOT carry.
   *
   * Tracing from the repository root is what makes the native modules and the
   * vendored catalogue resolve correctly, and the cost is that everything else
   * at the root is a candidate too. `desktop/` is the one that matters: it
   * holds the Rust build directory, so a second packaging run traced the
   * previous run's output and the standalone server grew to 7.5 GB — of which
   * 7.1 GB was a build cache the server has no use for.
   *
   * None of these are needed at runtime. The desktop shell, the first-launch
   * bootstrap and the sidecar launcher are shipped as their own Tauri
   * resources, beside the server rather than inside it.
   */
  outputFileTracingExcludes: {
    "*": [
      "desktop/**",
      "docs/**",
      "mobile/**",
      "qa-screenshots/**",
      "scripts/**",
      "data/**",
      ".next/standalone/**",
      "**/*.md",
      "*.txt",
      // The click-to-run installers belong beside the source, not inside the
      // server they install.
      "install.sh",
      "install-windows.cmd",
      "start.sh",
      /* The manifest is read by the first-launch bootstrap, which is shipped
         beside this server rather than inside it, and the server itself reads
         the generated module. A second copy in here would be a file nothing
         reads and somebody eventually edits. */
      "setup-manifest.json",
    ],
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
