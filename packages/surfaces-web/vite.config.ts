import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4321",
      "/auth": "http://127.0.0.1:4321",
      "/events": "http://127.0.0.1:4321",
      "/ws": {
        target: "ws://127.0.0.1:4321",
        ws: true,
      },
    }
  }
});
