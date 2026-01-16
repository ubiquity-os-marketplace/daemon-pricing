import { CONFIG_FULL_PATH, DEV_CONFIG_FULL_PATH } from "@ubiquity-os/plugin-sdk/constants";
import { ConfigurationHandler } from "@ubiquity-os/plugin-sdk/configuration";
import manifest from "../../manifest.json";
import { Context } from "../types/context";
import { isPushEvent } from "../types/typeguards";
import { getCommitChanges } from "./get-commit-changes";

export const ZERO_SHA = "0000000000000000000000000000000000000000";
const BASE_RATE_FILES = [DEV_CONFIG_FULL_PATH, CONFIG_FULL_PATH];

function normalizeConfig(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeConfig(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, normalizeConfig(entryValue)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

function serializeConfig(value: unknown): string {
  return JSON.stringify(normalizeConfig(value));
}

function createRefOctokit(context: Context, ref: string) {
  const baseOctokit = context.octokit;
  const targetRepo = context.payload.repository.name;
  return {
    ...baseOctokit,
    rest: {
      ...baseOctokit.rest,
      repos: {
        ...baseOctokit.rest.repos,
        getContent: (params: Parameters<typeof baseOctokit.rest.repos.getContent>[0]) => {
          const isConfigPath = params.path === CONFIG_FULL_PATH || params.path === DEV_CONFIG_FULL_PATH;
          const shouldPinRef = isConfigPath && params.repo === targetRepo;
          return baseOctokit.rest.repos.getContent({
            ...params,
            ...(shouldPinRef ? { ref } : {}),
          });
        },
      },
    },
  } as typeof baseOctokit;
}

export async function isConfigModified(context: Context): Promise<boolean> {
  if (!isPushEvent(context)) {
    context.logger.debug("Not a push event");
    return false;
  }
  const { logger, payload } = context;

  if (payload.before === ZERO_SHA) {
    logger.debug("Skipping push events. A new branch was created");
    return false;
  }

  const changes = getCommitChanges(payload.commits);

  if (changes && changes.length === 0) {
    logger.debug("No files were changed in the commits, so no action is required.");
    return false;
  }

  let hasConfigChange = false;

  for (const file of BASE_RATE_FILES) {
    if (changes.includes(file)) {
      logger.info(`${file} was modified or added in the commits`);
      hasConfigChange = true;
      break;
    }
  }

  if (!hasConfigChange) {
    return false;
  }

  const owner = payload.repository.owner?.login;
  if (!owner) {
    logger.warn("No owner found in the repository; cannot compare plugin configuration changes.");
    return false;
  }

  const repo = payload.repository.name;
  const beforeRef = payload.before;
  if (!beforeRef) {
    logger.warn("No base ref found for config comparison; assuming plugin configuration changed.");
    return true;
  }

  try {
    const beforeHandler = new ConfigurationHandler(logger, createRefOctokit(context, beforeRef));
    const afterHandler = new ConfigurationHandler(logger, context.octokit);
    const beforeConfig = await beforeHandler.getSelfConfiguration(manifest, { owner, repo });
    const afterConfig = await afterHandler.getSelfConfiguration(manifest, { owner, repo });

    if (!beforeConfig && !afterConfig) {
      logger.debug("No plugin configuration found in the config files; skipping plugin-specific updates.");
      return false;
    }

    if (serializeConfig(beforeConfig) === serializeConfig(afterConfig)) {
      logger.debug("Configuration changes do not affect this plugin; skipping updates.");
      return false;
    }

    logger.info("Detected plugin-specific configuration changes.");
    return true;
  } catch (err) {
    logger.warn("Failed to compare plugin configuration changes; skipping updates.", { err });
    return false;
  }
}
