import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: true,
    // Full-page render tests (src/app/page.test.tsx) take 3-8s each on slower
    // machines - longer than vitest's 5s default, and longer than some of
    // their own waitFor timeouts (8s) - which made them time out even on an
    // unmodified checkout.
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**"],
    },
  },
});
