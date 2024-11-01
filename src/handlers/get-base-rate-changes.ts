import { ContextPlugin, Rates } from "../types/plugin-input";
import { isPushEvent } from "../types/typeguards";

/**
 * Parses the diff of changes to the org config file to find the old and new base rates.
 *
 * This will capture changes to either the plugin's config or the global basePriceMultiplier.
 */
export async function getBaseRateChanges(context: ContextPlugin): Promise<Rates> {
  if (!isPushEvent(context)) {
    context.logger.debug("Not a push event");
    return {
      previousBaseRate: null,
      newBaseRate: null,
    };
  }
  const {
    logger,
    payload: { repository, head_commit: headCommit },
  } = context;
  const commitSha = headCommit?.id;
  let commitData;

  if (!commitSha) {
    throw new Error("No commit sha found");
  }
  const owner = repository.owner?.login;

  if (!owner) {
    throw logger.error("No owner found in the repository");
  }

  try {
    commitData = await context.octokit.rest.repos.getCommit({
      owner,
      repo: repository.name,
      ref: commitSha,
      mediaType: {
        format: "diff",
      },
    });
  } catch (err: unknown) {
    logger.debug("Commit sha error.", { err });
  }

  if (!commitData) {
    throw new Error("No commit data found");
  }

  const data = commitData.data as unknown as string;
  const changes = data.split("\n");

  const newValue = /\+\s*basePriceMultiplier:\s*(\S+)/;
  const oldValue = /-\s*basePriceMultiplier:\s*(\S+)/;

  const newBaseRate = extractBaseRate(changes, newValue);
  const previousBaseRate = extractBaseRate(changes, oldValue);

  if (!previousBaseRate && !newBaseRate) {
    logger.error("No base rate changes found in the diff");
  }

  return {
    previousBaseRate: previousBaseRate ? parseFloat(previousBaseRate) : null,
    newBaseRate: newBaseRate ? parseFloat(newBaseRate) : null,
  };
}

function extractBaseRate(changes: string[], regex: RegExp): string | undefined {
  const matchedLine = changes?.find((line) => regex.test(line));
  const match = matchedLine?.match(regex);
  return match ? match[1] : undefined;
}
