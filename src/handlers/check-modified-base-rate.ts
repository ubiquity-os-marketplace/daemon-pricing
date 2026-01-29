import { CONFIG_FULL_PATH, CONFIG_ORG_REPO, DEV_CONFIG_FULL_PATH } from "@ubiquity-os/plugin-sdk/constants";
import { ConfigurationHandler } from "@ubiquity-os/plugin-sdk/configuration";
import manifest from "../../manifest.json";
import { isDeepEqual } from "../shared/deep-equal";
import { Context } from "../types/context";
import { isPushEvent } from "../types/typeguards";
import { getCommitChanges } from "./get-commit-changes";

export const ZERO_SHA = "0000000000000000000000000000000000000000";
const BASE_RATE_FILES = [DEV_CONFIG_FULL_PATH, CONFIG_FULL_PATH];

function getConfigurationRefOptions(repo: string, ref: string) {
  if (repo === CONFIG_ORG_REPO) {
    return { repoRef: ref, orgRef: ref };
  }
  return { repoRef: ref };
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
    const beforeHandler = new ConfigurationHandler(logger, context.octokit);
    const afterHandler = new ConfigurationHandler(logger, context.octokit);
    const beforeRefOptions = getConfigurationRefOptions(repo, beforeRef);
    const afterRef = payload.after;
    const afterRefOptions = afterRef ? getConfigurationRefOptions(repo, afterRef) : undefined;
    const beforeConfig = await beforeHandler.getSelfConfiguration(manifest, { owner, repo }, beforeRefOptions);
    const afterConfig = await afterHandler.getSelfConfiguration(manifest, { owner, repo }, afterRefOptions);

    if (!beforeConfig && !afterConfig) {
      logger.debug("No plugin configuration found in the config files; skipping base rate updates.");
      return false;
    }

    const beforeBaseRate = beforeConfig?.basePriceMultiplier ?? null;
    const afterBaseRate = afterConfig?.basePriceMultiplier ?? null;

    if (isDeepEqual(beforeBaseRate, afterBaseRate)) {
      logger.debug("Base rate changes do not affect this plugin; skipping updates.");
      return false;
    }

    logger.info("Detected plugin base rate configuration changes.");
    return true;
  } catch (err) {
    logger.warn("Failed to compare plugin configuration changes; skipping updates.", { err });
    return false;
  }
}
