import type { NextConfig } from "next";

const config: NextConfig = {
  // Photos and scanned sheets are uploaded through server actions.
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  serverExternalPackages: ["pg", "exceljs", "pdf-lib", "jszip", "bcryptjs"],
  poweredByHeader: false,
  agentRules: false,
  turbopack: { root: __dirname },
};

export default config;
