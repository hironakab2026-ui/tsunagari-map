import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 53000,
    // ローカルで Azure Functions（api）と同時に動かす場合のプロキシ
    proxy: { "/api": "http://localhost:7071" },
  },
});
