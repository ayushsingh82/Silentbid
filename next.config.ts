import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Empty turbopack config to silence the webpack-only warning in Next 16
  turbopack: {},
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
        ],
      },
    ];
  },
  webpack: (config) => {
    // Optional: async WASM for future CRE / crypto helpers
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };
    // Fix @metamask/sdk trying to import react-native modules in browser builds
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

export default nextConfig;
