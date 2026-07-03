

const nextConfig = {
  experimental: {
    instrumentationHook: true,
    // Auto tree-shakes barrel imports (import { X, Y } from "lucide-react")
    // per-icon instead of pulling the whole package into the client bundle —
    // smaller JS to download/parse/hydrate on every page, especially the
    // batch table which imports 20+ icons.
    optimizePackageImports: ["lucide-react"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "*.fbcdn.net" },
      { protocol: "https", hostname: "*.facebook.com" },
    ],
  },
};

export default nextConfig;
