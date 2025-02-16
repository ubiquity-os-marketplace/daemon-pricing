import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/index.ts"],
  project: ["src/**/*.ts"],
  ignore: ["src/types/config.ts"],
  ignoreExportsUsedInFile: true,
  ignoreDependencies: ["ts-node", "eslint-plugin-prettier", "eslint-config-prettier", "@typescript-eslint/parser", "@typescript-eslint/eslint-plugin"],
};

export default config;
