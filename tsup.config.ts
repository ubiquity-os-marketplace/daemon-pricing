import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/action.ts",
  },
  splitting: false,
  sourcemap: false,
  clean: true,
  format: ["cjs"],
  minify: true,
  noExternal: [/.*/],
  outExtension() {
    return { js: ".cjs" };
  },
});
