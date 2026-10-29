import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace paketleri derlenmemiş TypeScript kaynağı olarak gelir.
  transpilePackages: ["@ys/core", "@ys/db", "@ys/media-gateway", "@ys/pipeline", "@ys/storage"],
  serverExternalPackages: ["@aws-sdk/client-s3", "postgres"],
};

export default config;
