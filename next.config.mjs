

const nextConfig = {
  experimental: { instrumentationHook: true },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "*.fbcdn.net" },
      { protocol: "https", hostname: "*.facebook.com" },
    ],
  },
};

export default nextConfig;
