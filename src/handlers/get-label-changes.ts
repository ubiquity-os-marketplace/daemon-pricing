import { ConfigurationHandler } from "@ubiquity-os/plugin-sdk/configuration";
import { CONFIG_FULL_PATH, CONFIG_ORG_REPO, DEV_CONFIG_FULL_PATH } from "@ubiquity-os/plugin-sdk/constants";
import manifest from "../../manifest.json";
import { isDeepEqual } from "../shared/deep-equal";
import { Context } from "../types/context";
import { isPushEvent } from "../types/typeguards";
import { ZERO_SHA } from "./check-modified-base-rate";
import { getCommitChanges } from "./get-commit-changes";

const CONFIG_FILES = [DEV_CONFIG_FULL_PATH, CONFIG_FULL_PATH];

function getConfigurationRefOptions(repo: string, ref: string) {
  if (repo === CONFIG_ORG_REPO) {
    return { repoRef: ref, orgRef: ref };
  }
  return { repoRef: ref };
}

export async function getLabelsChanges(context: Context) {
  if (!isPushEvent(context)) {
    context.logger.debug("Not a push event");
    return false;
  }

  const { logger, payload } = context;

  if (payload.before === ZERO_SHA) {
    logger.debug("Skipping label config comparison. A new branch was created");
    return false;
  }

  const changes = getCommitChanges(payload.commits);
  if (!changes?.length) {
    logger.debug("No files were changed in the commits, so no action is required.");
    return false;
  }

  const hasConfigChange = CONFIG_FILES.some((file) => changes.includes(file));
  if (!hasConfigChange) {
    logger.debug("No configuration files were changed; skipping label comparison.");
    return false;
  }

  const owner = payload.repository.owner?.login;
  if (!owner) {
    logger.warn("No owner found in the repository; cannot compare label configuration.");
    return false;
  }

  const repo = payload.repository.name;
  const beforeRef = payload.before;
  if (!beforeRef) {
    logger.warn("No base ref found for label configuration comparison; assuming labels changed.");
    return true;
  }

  try {
    const handler = new ConfigurationHandler(logger, context.octokit);
    const refOptions = getConfigurationRefOptions(repo, beforeRef);
    const beforeConfig = await handler.getSelfConfiguration(manifest, { owner, repo }, refOptions);
    const afterConfig = await handler.getSelfConfiguration(manifest, { owner, repo });

    const beforeLabels = beforeConfig?.labels ?? null;
    const afterLabels = afterConfig?.labels ?? null;

    if (!beforeLabels && !afterLabels) {
      logger.debug("No plugin label configuration found; skipping label comparison.");
      return false;
    }

    if (isDeepEqual(beforeLabels, afterLabels)) {
      logger.debug("No label changes found in the plugin configuration.");
      return false;
    }

    logger.info("Detected plugin label configuration changes.");
    return true;
  } catch (err) {
    logger.warn("Failed to compare label configuration changes; skipping updates.", { err });
    return false;
  }
}
