/** @type {import('next').NextConfig} */
const nextConfig = {
  // Off: StrictMode double-mounts components in dev, which re-initialises the
  // WebGL context and causes a visible flash. No effect in production.
  reactStrictMode: false,
  // The prebuilt embeddings index is imported as JSON at runtime; keep it bundled.
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse"],
  },
};

export default nextConfig;
