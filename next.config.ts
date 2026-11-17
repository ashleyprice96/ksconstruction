import type { NextConfig } from "next";

const config: NextConfig = {
  // Photos and scanned sheets are uploaded through server actions.
  experimental: { serverActions: { bodySizeLimit: "60mb" }, proxyClientMaxBodySize: "60mb" },
  serverExternalPackages: ["pg", "exceljs", "pdf-lib", "jszip", "bcryptjs", "@aws-sdk/client-s3"],
  poweredByHeader: false,
  agentRules: false,
  turbopack: { root: __dirname },
};

export default config;
