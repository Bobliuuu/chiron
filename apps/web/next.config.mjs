/** @type {import('next').NextConfig} */
const backendUrl =
  process.env.CHIRON_BACKEND_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:8787";

const nextConfig = {
  reactStrictMode: true,
  // @chiron/shared is consumed as TypeScript source from the monorepo.
  transpilePackages: ["@chiron/shared"],
  // Dev-only proxy so the browser talks same-origin (/chiron-api/*). Works when
  // only the Next.js port is forwarded (Cursor remote, ngrok on :3000, etc.).
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    return [
      {
        source: "/chiron-api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
