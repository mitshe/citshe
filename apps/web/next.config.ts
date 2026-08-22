import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Monorepo root (two levels up from apps/web). Next/Turbopack can't reliably
// infer the workspace root inside the Docker build, so pin it explicitly.
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const nextConfig: NextConfig = {
  output: 'standalone',
  // Pin turbopack + output tracing root for monorepo builds (needed in Docker).
  turbopack: {
    root: workspaceRoot,
  },
  outputFileTracingRoot: workspaceRoot,
  httpAgentOptions: {
    keepAlive: true,
  },
  experimental: {
    proxyTimeout: 300000,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
  async rewrites() {
    // Read BACKEND_URL here (not at module top level) so the standalone
    // server picks up the runtime env instead of a value inlined at build
    // time. In Docker this is http://api:3001; locally it falls back.
    const apiUrl = process.env.BACKEND_URL || "http://localhost:3001";
    return [
      {
        // Proxy /api/v1/* requests to NestJS backend
        source: "/api/v1/:path*",
        destination: `${apiUrl}/api/v1/:path*`,
      },
      {
        // Proxy /auth/* requests to NestJS backend
        source: "/auth/:path*",
        destination: `${apiUrl}/auth/:path*`,
      },
    ];
  },
};

// Sentry configuration
const sentryConfig = {
  // Suppress source map upload warnings during development
  silent: !process.env.CI,

  // Automatically tree-shake Sentry logger in production
  disableLogger: true,

  // Don't hide source maps from browser devtools
  hideSourceMaps: false,
};

export default withSentryConfig(nextConfig, sentryConfig);
