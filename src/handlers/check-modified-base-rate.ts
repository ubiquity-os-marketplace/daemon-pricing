import { CONFIG_FULL_PATH, DEV_CONFIG_FULL_PATH } from "@ubiquity-os/ubiquity-os-kernel";
import { ContextPlugin } from "../types/plugin-input";
import { isPushEvent } from "../types/typeguards";
import { getCommitChanges } from "./get-commit-changes";

export const ZERO_SHA = "0000000000000000000000000000000000000000";
const BASE_RATE_FILES = [DEV_CONFIG_FULL_PATH, CONFIG_FULL_PATH];

export async function isConfigModified(context: ContextPlugin): Promise<boolean> {
  if (!isPushEvent(context)) {
    context.logger.debug("Not a push event");
    return false;
  }
  const { logger, payload } = context;

  if (payload.before === ZERO_SHA) {
    logger.info("Skipping push events. A new branch was created");
    return false;
  }

  const changes = getCommitChanges(payload.commits);

  if (changes && changes.length === 0) {
    logger.info("No files were changed in the commits, so no action is required.");
    return false;
  }

  let shouldUpdateBaseRate = false;

  for (const file of BASE_RATE_FILES) {
    if (changes.includes(file)) {
      logger.info(`${file} was modified or added in the commits`);
      shouldUpdateBaseRate = true;
      break;
    }
  }

  return shouldUpdateBaseRate;
}
