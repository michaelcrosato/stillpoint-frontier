import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next. "build/**" is omitted: that
    // pattern assumes build/ is output, but here it holds build/sites-vite-plugin.ts,
    // which is real source that runs in the build pipeline.
    ".next/**",
    "out/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
