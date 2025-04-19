import { Context } from "../types/context.js";
import { isPushEvent } from "../types/typeguards.js";

export async function getLabelsChanges(context: Context) {
  if (!isPushEvent(context)) {
    context.logger.debug("Not a push event");
    return false;
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

  const newLabelsRegex = /\+\s*collaboratorOnly:\s*(\S+)/;
  const oldLabelsRegex = /-\s*collaboratorOnly:\s*(\S+)/;

  const newLabels = extractLabels(changes, newLabelsRegex);
  const previousLabels = extractLabels(changes, oldLabelsRegex);

  if (!previousLabels && !newLabels) {
    logger.error("No label changes found in the diff");
  }

  return !!previousLabels?.length || !!newLabels?.length;
}

function extractLabels(changes: string[], regex: RegExp): string | undefined {
  const matchedLine = changes?.find((line) => regex.test(line));
  const match = matchedLine?.match(regex);
  return match ? match[1] : undefined;
}
