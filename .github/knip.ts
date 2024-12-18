import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/index.ts"],
  project: ["src/**/*.ts"],
  ignore: ["src/types/config.ts", "src/adapters/supabase/types/database.ts"],
  ignoreExportsUsedInFile: true,
  ignoreDependencies: [
    "ts-node",
    "@types/jest",
    "eslint-plugin-prettier",
    "eslint-config-prettier",
    "@typescript-eslint/parser",
    "@typescript-eslint/eslint-plugin",
  ],
};

export default config;
