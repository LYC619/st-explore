import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { tavernFrontend } from "./scripts/tavern/vite-plugin.mjs";
import { resolveBuildInfo } from "./scripts/build-info.mjs";

const buildInfo = resolveBuildInfo();

// https://vitejs.dev/config/
export default defineConfig({
  define: { __STE_BUILD_INFO__: JSON.stringify(buildInfo) },
  server: {
    host: "::",
    port: 8080,
    watch: {
      // 参考项目(_reference/projects/*)是借鉴用的外部源码(含 Vue/Astro 等异构栈)，
      // 不属于本项目，排除以免 vite 扫描其依赖报错(vue/pinia/pixi.js 未安装)
      ignored: ["**/_reference/**", "**/vendor/**", "**/.cache/**", "**/_archive/**"],
    },
  },
  plugins: [tavernFrontend(), react(), {
    name: 'ste-build-receipt',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify(buildInfo, null, 2) + '\n' });
    },
  }],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  optimizeDeps: {
    // 别让依赖预扫描去解析参考项目里的 import
    entries: ["index.html", "src/**/*.{ts,tsx}"],
  },
});
