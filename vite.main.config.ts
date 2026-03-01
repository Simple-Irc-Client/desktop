import { defineConfig } from "vite";
import { builtinModules } from "module";
import { cpSync, existsSync } from "fs";

function copyIfExists(src: string, dest: string, opts?: { recursive: boolean }) {
  if (existsSync(src)) {
    cpSync(src, dest, opts);
  }
}

function copyStaticFiles() {
  return {
    name: "copy-static-files",
    closeBundle() {
      copyIfExists("src/irc-network.cjs", "dist/irc-network.cjs");
      copyIfExists("src/preload.cjs", "dist/preload.cjs");
      copyIfExists("src/index.html", "dist/index.html");
      copyIfExists("src/icons", "dist/icons", { recursive: true });
      copyIfExists("src/assets", "dist/assets", { recursive: true });
      copyIfExists("src/favicon.ico", "dist/favicon.ico");
      copyIfExists("src/logo.svg", "dist/logo.svg");
    },
  };
}

export default defineConfig({
  build: {
    outDir: "dist",
    lib: {
      entry: "src/index.js",
      formats: ["cjs"],
      fileName: () => "main.cjs",
    },
    rollupOptions: {
      external: [
        "electron",
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
    minify: false,
    emptyOutDir: true,
  },
  plugins: [copyStaticFiles()],
});
