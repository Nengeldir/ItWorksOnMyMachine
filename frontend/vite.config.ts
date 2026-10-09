import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // three.js alone is ~700 kB (~180 kB gzipped), and the game needs all of it up front
    chunkSizeWarningLimit: 1000,
  },
  server: {
    proxy: {
      // Forward all requests to the backend server
      "/api": "http://localhost:8000",
    },
  },
});
