import { defineConfig, type UserConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const config: UserConfig = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart({
      router: { routeTreeFileHeader: [], quoteStyle: "double", semicolons: true },
      spa: { enabled: true, prerender: { outputPath: "/index.html" } },
    }),
    react(),
  ],
  server: { host: "127.0.0.1", proxy: { "/rpc": { target: "http://127.0.0.1:4400", ws: true } } },
});

export default config;
