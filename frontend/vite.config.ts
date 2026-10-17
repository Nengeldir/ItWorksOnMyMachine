import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const OPEN_WORLD_CHUNKS: [folder: string, chunk: string][] = [
  ["/src/game/reaches/", "reaches"],
  ["/src/game/combat/", "combat"],
  ["/src/game/windspire/", "windspire"],
  ["/src/game/social/", "social"],
];

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // three.js alone is ~700 kB (~180 kB gzipped) and the game (biomes, terrain,
    // plants, water, the run) another ~380 kB, all needed up front; bloom and the
    // tuning panel load on demand
    chunkSizeWarningLimit: 1200,
    // scripts/bundle-check.mjs reads which files the first load needs from here
    manifest: true,
    rolldownOptions: {
      output: {
        // The open world's modes each land in a chunk of their own (plan F11), loaded with import() by
        // their sessions; races never fetch them. Folders that don't exist yet match nothing
        codeSplitting: {
          groups: [{ name: (id: string) => OPEN_WORLD_CHUNKS.find(([folder]) => id.includes(folder))?.[1] ?? null }],
        },
      },
    },
  },
  server: {
    // The shared catalog (../shared/catalog, read by the backend too) lives outside this folder
    fs: { allow: [".", "../shared"] },
    proxy: {
      // Forward all requests to the backend server
      "/api": "http://localhost:8000",
    },
  },
});
