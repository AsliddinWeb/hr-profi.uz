/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // The backend proxy: in production we ship behind Traefik/nginx and the
  // API_URL is relative ("/api/v1"). For dev, point at the local FastAPI.
  async rewrites() {
    const target =
      process.env.API_PROXY_TARGET || "http://localhost:8000";
    return [
      { source: "/api/:path*", destination: `${target}/api/:path*` },
      { source: "/ws/:path*", destination: `${target}/ws/:path*` },
    ];
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // PWA-ready response headers — the manifest must be served correctly.
  async headers() {
    return [
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
      {
        source: "/sw.js",
        headers: [{ key: "Service-Worker-Allowed", value: "/" }],
      },
    ];
  },
};

module.exports = nextConfig;
