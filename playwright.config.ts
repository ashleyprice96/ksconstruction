import { defineConfig } from "@playwright/test";

// Run against a server that is already running with the demo seed loaded:
//   npm run build && npm start   (or npm run dev)
//   BASE_URL=http://localhost:3000 npm run test:leaks
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 240_000,
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000", acceptDownloads: true },
  reporter: [["list"]],
});
