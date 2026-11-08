import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // vtk.js 38 is ESM-only without an "exports" map and is imported through
  // many subpaths. Pre-bundling each subpath separately would duplicate its
  // internal macro/override registry, breaking Geometry profile registration.
  // Since the scanner does not descend into an excluded package, its own
  // third-party deps (some CommonJS) must be prebundled explicitly.
  optimizeDeps: {
    exclude: ["@kitware/vtk.js"],
    include: ["gl-matrix", "d3-scale", "fast-deep-equal", "seedrandom", "spark-md5"],
  },
  build: {
    outDir: "build",
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 3000,
  },
  preview: {
    port: 3000,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    mockReset: true,
  },
});
