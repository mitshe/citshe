import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  dts: false,
  sourcemap: false,
  // Prepend a shebang so the built entry is directly executable via `bin`.
  banner: {
    js: "#!/usr/bin/env node",
  },
});
