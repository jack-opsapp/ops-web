import { defineConfig } from "vitest/config";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export default defineConfig({
  test: {
    environment: "node",
    minWorkers: 1,
    maxWorkers: 1,
    include: [
      "src/lib/api/services/__tests__/site-visit-approval.test.ts",
      "src/lib/agent-control-plane/services/site-visit-workflow/**/*.test.ts",
      "src/lib/agent-control-plane/services/p2/site-visits/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../src"),
      "server-only": require.resolve("next/dist/compiled/server-only/empty.js"),
    },
  },
});
