import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // three.js alone is ~700 kB (~180 kB gzipped) and the game (biomes, terrain,
    // plants, water, the run) another ~380 kB, all needed up front; bloom and the
    // tuning panel load on demand
    chunkSizeWarningLimit: 1200,
  },
  server: {
    proxy: {
      // Forward all requests to the backend server
      "/api": "http://localhost:8000",
    },
  },
});
