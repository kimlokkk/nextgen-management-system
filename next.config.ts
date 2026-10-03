import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,

  allowedDevOrigins: [
    "nextgen.test",
  ],
};

export default nextConfig;