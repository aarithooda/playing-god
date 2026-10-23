/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The backend serves /api/v1/* and /healthz itself, so the dev proxy forwards paths unchanged
// (no prefix rewrite). Set BACKEND_URL (shell or .env) if the backend is not on 127.0.0.1:8000.
export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, ".", "").BACKEND_URL || "http://127.0.0.1:8000";
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": { target },
        "/healthz": { target },
      },
    },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
