import { defineConfig, loadEnv } from "vite";
import { resolveViteBase } from "./src/runtime/deployment.js";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, ".", "VITE_");
  return {
    // Relative by default so the static output works under a GitHub Pages repository subpath.
    base: resolveViteBase(environment.VITE_BASE_PATH),
    server: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
    preview: {
      host: "127.0.0.1",
      port: 4174,
    },
    build: {
      target: "es2022",
      sourcemap: true,
    },
  };
});
