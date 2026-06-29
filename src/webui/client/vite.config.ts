import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve("src/webui/client"),
  plugins: [react()],
  build: {
    outDir: path.resolve("dist/webui/client"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve("src/webui/client/src"),
    },
  },
});
