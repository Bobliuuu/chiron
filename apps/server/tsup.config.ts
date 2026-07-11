import { defineConfig } from "tsup";

// Bundle the server to a single self-contained ESM file. `@chiron/shared` is a
// workspace package consumed as TypeScript source, so we inline it (noExternal)
// — the Docker runtime image then only needs the third-party deps, not the
// monorepo's workspace symlinks.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  noExternal: ["@chiron/shared"],
});
