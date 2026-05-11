import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Without an explicit URL jsdom defaults to an opaque origin
    // (`about:blank`), which causes `localStorage` to throw
    // `SecurityError: localStorage is not available for opaque origins`
    // — which surfaces in Zustand's persist middleware as
    // "storage.setItem is not a function" and breaks every integration
    // test that touches the auth store. Setting a non-opaque URL lets
    // jsdom provision a real Storage instance.
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.{test,spec}.{ts,tsx}", "src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/**/index.ts",
        "src/app/**/layout.tsx",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Aliases `server-only` to Next's empty shim so server-guarded
      // modules can be imported in Vitest. Tradeoff: silently hides
      // `server-only` violations from client-component tests. If you add
      // client-component tests that need to detect this, consider scoping
      // this alias via `test.server.conditions` or a separate test
      // project config.
      //
      // Background: `server-only` is a marker module Next.js bundles
      // internally and does not hoist to the top-level `node_modules`.
      // Use `require.resolve` so Node's standard module resolution walks
      // up from this file to find `node_modules/next` — works equivalently
      // whether vitest runs from the main checkout (local `node_modules`)
      // or a git worktree (which shares `node_modules` with the parent).
      "server-only": require.resolve("next/dist/compiled/server-only/empty.js"),
    },
  },
});
