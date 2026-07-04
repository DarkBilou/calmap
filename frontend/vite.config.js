import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En dev, les appels /api/* sont relayés vers le backend FastAPI (port 8000),
// si bien que API_BASE_URL peut rester vide dans les deux modes.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
