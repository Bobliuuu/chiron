/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @chiron/shared is consumed as TypeScript source from the monorepo.
  transpilePackages: ["@chiron/shared"],
};

export default nextConfig;
