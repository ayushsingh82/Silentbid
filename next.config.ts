import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Empty turbopack config to silence the webpack-only warning in Next 16
  turbopack: {},
  // COEP needed for Zama fhEVM WASM; COOP must NOT be same-origin (breaks wallet popups)
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
    // Required for @zama-fhe/relayer-sdk WASM module (webpack fallback)
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
