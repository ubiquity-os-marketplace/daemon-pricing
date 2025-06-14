import { addLabelToIssue, createLabel } from "../shared/label";
import { Context } from "../types/context";
import { Label } from "../types/github";
import { isIssueLabelEvent } from "../types/typeguards";
import { convertHoursLabel, getPricing, getPriorityTime, PriorityTimeEstimate } from "./get-priority-time";

export async function autoPricingHandler(context: Context): Promise<void> {
  const { logger } = context;
  if (!isIssueLabelEvent(context)) {
    logger.debug("Not an issue event, skipping.");
    return;
  }
  await removeAllPriceLabels(context);
  await handleNoLabels(context);
}

export function checkIfLabelContainsTrigger(context: Context): boolean {
  if (!isIssueLabelEvent(context)) {
    context.logger.debug("Not an issue event, skipping.");
    return false;
  }
  const issue = getIssueFromPayload(context);
  if (!issue) {
    context.logger.error("No issue found in the payload.");
    return false;
  }
  const labels = issue.labels as Label[];
  const triggerLabel = context.config.autoLabelingTrigger;
  return labels.some((label) => label.name.toLowerCase().includes(triggerLabel.toLowerCase()));
}

export async function onLabelChangeAiEstimation(context: Context): Promise<void> {
  if (!isIssueLabelEvent(context)) {
    return;
  }
  const label = context.payload.label?.name,
    sender = context.payload.sender;
  if (!label || ignoreLabelChange(context, sender, label)) return;

  const { payload } = context;
  await removeAllPriceLabels(context);

  const labels = (payload.issue.labels as Label[]) || [];
  const priorityLabels = labels.filter((label) => label.name.toLowerCase().startsWith("priority:"));
  const timeLabels = labels.filter((label) => label.name.toLowerCase().startsWith("time:"));

  if (priorityLabels.length > 0 && timeLabels.length > 0) {
    await handleTimeAndPriorityLabels(context, timeLabels, priorityLabels);
  } else if (priorityLabels.length > 0) {
    await handlePriorityLabel(context, priorityLabels);
  } else if (timeLabels.length > 0) {
    await handleTimeLabel(context, timeLabels);
  } else {
    await handleNoLabels(context);
  }
}

async function handleNoLabels(context: Context): Promise<void> {
  const { logger, config } = context;
  logger.info("Estimating both time and priority with AI.");

  const estimation = await fetchAiEstimates(context);
  if (!estimation) return;

  const { time: timeString, priority: priorityLabel } = estimation;
  const timeInHours = parseFloat(timeString);
  const timeLabel = convertHoursLabel(timeString);

  logger.info(`AI estimated time: ${timeInHours} hours. Creating label: "${timeLabel}"`);
  await createAndAddLabel(context, timeLabel);

  logger.info(`AI estimated priority: "${priorityLabel}". Creating label.`);
  await createAndAddLabel(context, priorityLabel);

  const priceLabel = `Price: ${getPricing(config.basePriceMultiplier, timeInHours, priorityLabel).toFixed(2)} USD`;
  logger.info(`Calculated price with AI estimates: ${priceLabel}`);
  await createAndAddLabel(context, priceLabel);
}

async function handleTimeAndPriorityLabels(context: Context, timeLabels: Label[], priorityLabels: Label[]): Promise<void> {
  const { logger, config } = context;
  const issue = getIssueFromPayload(context);
  if (!issue) {
    logger.error("No issue found in the payload.");
    return;
  }

  const highestPriority = getHighestPriority(priorityLabels);
  const totalTimeInHours = getTotalTimeInHours(timeLabels);

  if (!highestPriority || totalTimeInHours <= 0) {
    logger.error("Could not determine priority or time from labels.");
    return;
  }

  const price = getPricing(config.basePriceMultiplier, totalTimeInHours, highestPriority).toFixed(2);
  const priceLabel = `Price: ${price} USD`;

  logger.info(`Calculated price: ${priceLabel} based on ${totalTimeInHours} hours and "${highestPriority}" priority.`);
  await createAndAddLabel(context, priceLabel, `Added price label "${priceLabel}" to issue #${issue.number}`);
}

async function handlePriorityLabel(context: Context, priorityLabels: Label[]): Promise<void> {
  const { logger, config } = context;
  const highestPriority = getHighestPriority(priorityLabels);
  if (!highestPriority) {
    logger.error("Could not determine the highest priority from the provided labels.");
    return;
  }

  const estimation = await fetchAiEstimates(context);
  if (!estimation) return;

  const timeInHours = parseFloat(estimation.time);
  const timeLabel = convertHoursLabel(estimation.time);

  logger.info(`AI estimated time: ${timeInHours} hours. Creating label: "${timeLabel}"`);
  await createAndAddLabel(context, timeLabel);

  const price = getPricing(config.basePriceMultiplier, timeInHours, highestPriority).toFixed(2);
  const priceLabel = `Price: ${price} USD`;

  logger.info(`Calculated price with AI-time: ${priceLabel}`);
  await createAndAddLabel(context, priceLabel);
}

async function handleTimeLabel(context: Context, timeLabels: Label[]): Promise<void> {
  const { logger, config } = context;
  const totalTimeInHours = getTotalTimeInHours(timeLabels);
  if (totalTimeInHours <= 0) {
    logger.error("Could not calculate a valid time from the provided labels.");
    return;
  }

  const estimation = await fetchAiEstimates(context);
  if (!estimation) return;

  const { priority: priorityLabel } = estimation;
  logger.info(`AI estimated priority: "${priorityLabel}"`);
  await createAndAddLabel(context, priorityLabel);

  const price = getPricing(config.basePriceMultiplier, totalTimeInHours, priorityLabel).toFixed(2);
  const priceLabel = `Price: ${price} USD`;

  logger.info(`Calculated price with AI-priority: ${priceLabel}`);
  await createAndAddLabel(context, priceLabel);
}

async function fetchAiEstimates(context: Context): Promise<PriorityTimeEstimate | null> {
  const { logger, env } = context;
  const issue = getIssueFromPayload(context);
  if (!issue) {
    logger.error("No issue found in the payload.");
    return null;
  }

  if (!issue.body || !env.BASETEN_API_KEY || !env.BASETEN_API_URL) {
    logger.error("Missing issue body or API credentials for AI estimation.");
    return null;
  }

  try {
    const estimation = await getPriorityTime(issue.body, issue.title, env.BASETEN_API_KEY, env.BASETEN_API_URL);
    if (!estimation) {
      logger.error("AI failed to return an estimate.");
      return null;
    }
    return estimation;
  } catch (error) {
    logger.error("An error occurred while fetching AI estimates:", { err: error });
    return null;
  }
}

async function createAndAddLabel(context: Context, labelName: string, successLog?: string): Promise<void> {
  await createLabel(context, labelName);
  await addLabelToIssue(context, labelName);
  if (successLog) {
    context.logger.info(successLog);
  }
}

function getHighestPriority(priorityLabels: Label[]): string | null {
  let highestPriorityLabel: string | null = null;
  let maxPriorityValue = -1;
  const regex = /Priority:\s*(\d+)\s*\(/i;

  for (const label of priorityLabels) {
    const match = RegExp(regex).exec(label.name);
    if (match && match[1]) {
      const priorityValue = parseInt(match[1], 10);
      if (priorityValue > maxPriorityValue) {
        maxPriorityValue = priorityValue;
        highestPriorityLabel = label.name;
      }
    }
  }
  return highestPriorityLabel;
}

function parseTimeLabelToHours(timeLabel: string): number {
  let totalHours = 0;
  const unitToHoursMap: { [key: string]: number } = {
    minute: 1 / 60,
    min: 1 / 60,
    hour: 1,
    hr: 1,
    h: 1,
    day: 24,
    d: 24,
    week: 168,
    w: 168,
    month: 720,
  };
  const regex = /(\d+(\.\d+)?)\s*?(minute|min|hour|hr|h|day|d|week|w|month)s?/gi;
  let match;
  while ((match = regex.exec(timeLabel)) !== null) {
    totalHours += parseFloat(match[1]) * unitToHoursMap[match[3].toLowerCase()];
  }
  return totalHours;
}

function getTotalTimeInHours(timeLabels: Label[]): number {
  return timeLabels.reduce((total, label) => total + parseTimeLabelToHours(label.name), 0);
}

function ignoreLabelChange(context: Context, sender: Context["payload"]["sender"], labelName: string): boolean {
  if (sender?.type === "Bot" && labelName && (labelName.startsWith("Time:") || labelName.startsWith("Priority:") || labelName.startsWith("Price:"))) {
    context.logger.info(`Ignoring label change event for "${labelName}" from bot.`);
    return true;
  }
  return false;
}

async function removeAllPriceLabels(context: Context): Promise<void> {
  const { payload, logger, octokit } = context;
  const issue = getIssueFromPayload(context);
  if (!issue) {
    logger.error("No issue found in the payload.");
    return;
  }
  if (!payload.repository.owner || !payload.repository.name) {
    logger.error("Repository owner or name is missing in the payload.");
    return;
  }
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;

  const labelsToRemove = (issue.labels as Label[]).filter((label) => label.name.startsWith("Price:")).map((label) => label.name);

  if (labelsToRemove.length > 0) {
    logger.info(`Removing old price labels: ${labelsToRemove.join(", ")}`);
    for (const label of labelsToRemove) {
      try {
        await octokit.rest.issues.removeLabel({ owner, repo, issue_number: issue.number, name: label });
        logger.info(`Removed label "${label}" from issue #${issue.number}`);
      } catch (error) {
        logger.error(`Failed to remove label "${label}" from issue #${issue.number}`, { err: error });
      }
    }
  }
}

function getIssueFromPayload(context: Context) {
  if (!isIssueLabelEvent(context)) {
    context.logger.debug("Not an issue event, skipping.");
    return null;
  }
  const issue = context.payload.issue;
  return issue;
}
