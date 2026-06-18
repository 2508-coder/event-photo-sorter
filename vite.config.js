import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Two pages: the main app (index.html) and the public guest site (guest.html).
export default defineConfig({
  plugins: [react()],
  server: { host: true },
  optimizeDeps: { exclude: ["@xenova/transformers"] },
  build: {
    rollupOptions: {
      input: { main: "index.html", guest: "guest.html" },
    },
  },
});
