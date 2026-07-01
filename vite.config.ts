import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Prevent vite from obscuring Rust errors
  clearScreen: false,

  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("react/") || id.includes("react-dom/") || id.includes("scheduler/")) {
            return "vendor-react";
          }
          if (
            id.includes("react-markdown") ||
            id.includes("remark-") ||
            id.includes("rehype-") ||
            id.includes("unified") ||
            id.includes("mdast-util") ||
            id.includes("micromark") ||
            id.includes("hast-util") ||
            id.includes("property-information") ||
            id.includes("vfile")
          ) {
            return "vendor-markdown";
          }
          if (id.includes("cytoscape-fcose")) return "vendor-cytoscape-fcose";
          if (id.includes("cytoscape-cose-bilkent")) return "vendor-cytoscape-cose-bilkent";
          if (id.includes("cytoscape")) return "vendor-cytoscape-core";
          if (id.includes("katex")) return "vendor-katex";
          if (id.includes("framer-motion")) return "vendor-motion";
        },
      },
    },
  },
});
