import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const entry = fileURLToPath(new URL("./src/vtk2three/index.ts", import.meta.url));

export default defineConfig({
  // The demo's public/ assets must not be published with the library.
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry,
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "vtk2three.js" : "vtk2three.cjs"),
    },
    rolldownOptions: {
      // Consumers bring their own copies of three / vtk.js (peer deps).
      external: ["three", /^three\//, /^@kitware\/vtk\.js\//],
    },
  },
});
