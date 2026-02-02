import type { KnipConfig } from "knip";

const config: KnipConfig = {
  project: ["src/**/*.ts"],
  ignore: ["src/types/config.ts"],
  ignoreExportsUsedInFile: true,
  ignoreDependencies: ["ts-node", "@typescript-eslint/parser", "@typescript-eslint/eslint-plugin"],
};

export default config;
