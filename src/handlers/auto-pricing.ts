// First we need the time and priority values
// Once we have those, we need to make actual labels
// Once we have the actual labels, we'll add those to the issue
// Rest of the process should follow the same logic as before

import { addLabelToIssue, createLabel } from "../shared/label";
import { Context } from "../types/context";
import { Label } from "../types/github";
import { convertHoursLabel, getPriorityTime } from "./get-priority-time";

// Expected to run on "issues.created" and "issues.edited" events

export async function autoPricingHandler(context: Context<"issues.opened">): Promise<void> {
  const { payload, logger, env } = context;
  if (!("issue" in payload) || !payload.issue) {
    logger.debug("No issue found in the payload");
    return;
  }
  const issue = payload.issue;
  const labels = (issue.labels as Label[]) || [];
  if (!labels || labels.length === 0) {
    logger.info("No labels found on the issue, skipping pricing labels update.");
  } else {
    const priorityLabels = getPriorityLabels(labels);
    const timeLabels = getTimeLabels(labels);
    await removeLabels(context, [...priorityLabels.map((l) => l.name), ...timeLabels.map((l) => l.name)]);
    logger.info("Removed existing priority and time labels from the issue.");
  }

  if (!issue.body) {
    logger.info("No issue body found, skipping pricing labels update.");
    return;
  }

  if (env.BASETEN_API_KEY === undefined || env.BASETEN_API_URL === undefined) {
    throw logger.error("BASETEN_API_KEY or BASETEN_API_URL is not set in the environment variables.");
  }

  const priorityTimeEstimate = await getPriorityTime(issue.body, issue.title, env.BASETEN_API_KEY, env.BASETEN_API_URL);

  if (!priorityTimeEstimate) {
    logger.error("No priority time estimate found, skipping pricing labels update.");
    return;
  }

  const { time, priority } = priorityTimeEstimate;
  logger.info(`Priority: ${priority}, Time: ${time} hours`);
  const timeLabel = convertHoursLabel(time);

  await createLabel(context, timeLabel);

  await addLabelToIssue(context, priority);
  await addLabelToIssue(context, timeLabel);
  logger.info(`Added priority label: ${priority} and time label: ${timeLabel} to the issue #${issue.number}`);
}

// Returns the priority labels on the issue
function getPriorityLabels(labels: Label[]): Label[] {
  return labels.filter((label) => label.name.startsWith("Priority: "));
}

function getTimeLabels(labels: Label[]): Label[] {
  return labels.filter((label) => label.name.startsWith("Time: "));
}

async function removeLabels(context: Context<"issues.opened">, labelsToRemove: string[]): Promise<void> {
  const { issue } = context.payload;
  if (!issue || !issue.number || !context.payload.repository || !context.payload.repository.owner) {
    context.logger.debug("No issue number or repository/owner found in the payload");
    return Promise.resolve();
  }

  const owner = context.payload.repository.owner.login;
  const repo = context.payload.repository.name;
  labelsToRemove.forEach(async (label) => {
    try {
      await context.octokit.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: issue.number,
        name: label,
      });
      context.logger.info(`Removed label ${label} from issue #${issue.number}`);
    } catch (error) {
      context.logger.error(`Failed to remove label ${label} from issue #${issue.number}`, { stack: error instanceof Error ? error.stack : String(error) });
    }
  });
}
