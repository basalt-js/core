import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts"
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: false,
  tsconfig: "tsconfig.build.json",
  // JSDoc ships in the .d.ts files; copying it into the JS only inflates the bundle.
  // Keep legal comments and pure annotations (consumers' tree-shaking uses them).
  outputOptions: { comments: { legal: true, annotation: true, jsdoc: false } }
});
