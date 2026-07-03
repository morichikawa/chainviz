/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Repo-root `glossary/` は用語データの正となる置き場所。ここを alias で参照し、
// `?raw` インポートで YAML テキストとして取り込む。
const glossaryDir = fileURLToPath(new URL("../../glossary", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@glossary": glossaryDir,
    },
  },
  build: {
    // tsc -b の出力（dist/）と混ざらないよう web バンドルは dist-web へ。
    outDir: "dist-web",
  },
  server: {
    fs: {
      // glossary/ はパッケージ外にあるため明示的に許可する。
      allow: [repoRoot],
    },
  },
  test: {
    environment: "jsdom",
    // localStorage は不透明オリジン(about:blank)では使えないため URL を与える。
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
