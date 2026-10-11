import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
const apiTarget = `http://127.0.0.1:${process.env.PORT || 8787}`;
const allowedHosts = ['.e2b.app', 'localhost', '127.0.0.1'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    allowedHosts,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/peerjs': { target: apiTarget, changeOrigin: true, ws: true },
    },
  },
  preview: { host: '0.0.0.0', allowedHosts },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
