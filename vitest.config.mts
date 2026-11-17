import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { include: ["tests/unit/**/*.test.ts"], testTimeout: 20000, fileParallelism: false },
  resolve: {
    alias: {
      "server-only": path.resolve("./tests/stubs/server-only.ts"),
    },
  },
});

