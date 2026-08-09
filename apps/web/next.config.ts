import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // game-mechanics ships TypeScript source from the workspace — Next must
  // transpile it like app code.
  transpilePackages: ["game-mechanics"],
};

export default nextConfig;
