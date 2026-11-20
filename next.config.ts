import type { NextConfig } from "next";

const config: NextConfig = {
  // Server actions stay under Vercel's 4.5 MB function body. Large PDFs go straight to storage.
  // The proxy limit stays high so a Render upload of a 50 MB PDF still reaches the route.
  experimental: { serverActions: { bodySizeLimit: "4mb" }, proxyClientMaxBodySize: "60mb" },
  serverExternalPackages: ["pg", "exceljs", "pdf-lib", "jszip", "bcryptjs", "@aws-sdk/client-s3"],
  poweredByHeader: false,
  agentRules: false,
  turbopack: { root: __dirname },
};

export default config;
