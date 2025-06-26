import { addLabelToIssue, clearAllPriceLabelsOnIssue, createLabel } from "../shared/label";
import { handlePermissionCheck } from "../shared/permissions";
import { calculateLabelValue } from "../shared/pricing";
import { Context } from "../types/context";
import { Label } from "../types/github";
import { isIssueLabelEvent } from "../types/typeguards";
import { convertHoursLabel, getPricing, getPriorityTime, PriorityTimeEstimate } from "./get-priority-time";
import { extractLabelPattern } from "./label-checks";
import { onLabelChangeSetPricing } from "./pricing-label";
interface PricingResult {
  timeLabelValue: number;
  priorityLabel: string;
}

export async function autoPricingHandler(context: Context): Promise<void> {
  const issue = getIssueFromPayload(context);
  if (!issue) {
    throw context.logger.error("No issue found in the payload.");
  }
  await clearAllPriceLabelsOnIssue(context);
  const estimate = await fetchAiEstimates(context);
  const pricingResult = await handleNoLabels(context, estimate);
  await setPrice(context, pricingResult);
  await addLabelToIssue(context, context.config.autoLabeling.triggerLabel);
}

export async function onLabelChangeAiEstimation(context: Context) {
  if (!isIssueLabelEvent(context)) {
    return;
  }
  await handlePermissionCheck(context);
  const { label, sender, issue } = context.payload;
  if (!label || ignoreLabelChange(context, sender, label.name)) return;

  await clearAllPriceLabelsOnIssue(context);
  const issueLabels = (issue.labels as Label[]) || [];
  const timeLabels = issueLabels.filter((label) => label.name.toLowerCase().startsWith("time:"));
  const timeRegex = extractLabelPattern(context.config.labels.time);
  const priorityRegex = extractLabelPattern(context.config.labels.priority);
  //test all timeLabels and priorityLabels against the regex
  const isTimeLabelValid = timeLabels.every((label) => timeRegex.test(label.name));
  const priorityLabels = issueLabels.filter((label) => priorityRegex.test(label.name));
  const isPriorityLabelValid = priorityLabels.every((label) => priorityRegex.test(label.name));

  //validation for priority labels
  if (!isPriorityLabelValid) {
    context.logger.warn(`Priority label "${priorityLabels[0].name}" does not match the expected pattern.`);
    return;
  }

  //time label validation
  if (priorityLabels.length > 0 && timeLabels.length > 0 && isTimeLabelValid) {
    await onLabelChangeSetPricing(context); //skip ai estimation if both labels are present
    return;
  }

  await processAiEstimation(context, timeLabels, priorityLabels);
}

async function setPrice(context: Context, priceLabels: PricingResult, currency: string = "USD") {
  const { logger } = context;
  await clearAllPriceLabelsOnIssue(context);
  const priceLabelName = `Price: ${getPricing(context.config.basePriceMultiplier, priceLabels.timeLabelValue, priceLabels.priorityLabel)} ${currency}`;
  logger.info(`Setting price label: "${priceLabelName}"`);
  await createAndAddLabel(context, priceLabelName);
}

async function handleNoLabels(context: Context, estimate: PriorityTimeEstimate): Promise<PricingResult> {
  const { logger } = context;
  logger.info("Estimating both time and priority with AI.");

  const { time: timeString, priority: priorityLabel } = estimate;
  const timeInHours = parseFloat(timeString);
  const timeLabel = convertHoursLabel(timeString);

  logger.info(`AI estimated time: ${timeInHours} hours. Creating label: "${timeLabel}"`);
  await createAndAddLabel(context, timeLabel);

  logger.info(`AI estimated priority: "${priorityLabel}". Creating label.`);
  await addLabelToIssue(context, priorityLabel);

  return {
    timeLabelValue: timeInHours,
    priorityLabel,
  };
}

async function handlePriorityLabel(context: Context, priorityLabels: Label[], estimate: PriorityTimeEstimate): Promise<PricingResult> {
  const { logger } = context;
  const minPriority = getMinPriorityLabel(context, priorityLabels);
  if (!minPriority) {
    throw logger.error("Could not determine the highest priority from the provided labels.");
  }

  await retainMinimumLabels(context, priorityLabels, minPriority);
  const timeInHours = parseFloat(estimate.time);
  const timeLabel = convertHoursLabel(estimate.time);

  logger.info(`AI estimated time: ${timeInHours} hours. Creating label: "${timeLabel}"`);
  await createAndAddLabel(context, timeLabel);

  return {
    timeLabelValue: timeInHours,
    priorityLabel: minPriority.name,
  };
}

async function handleTimeAndPriorityLabels(context: Context, timeLabels: Label[], priorityLabels: Label[]): Promise<PricingResult> {
  const { logger } = context;
  const issue = getIssueFromPayload(context);
  if (!issue) {
    throw logger.error("No issue found in the payload.");
  }

  const minPriority = getMinPriorityLabel(context, priorityLabels);
  const minTimeLabel = getMinTimeLabel(context, timeLabels);

  if (!minPriority || !minTimeLabel) {
    throw logger.error("Could not determine priority or time from labels.");
  }

  await retainMinimumLabels(context, timeLabels, minTimeLabel);
  await retainMinimumLabels(context, priorityLabels, minPriority);

  return {
    timeLabelValue: parseTimeLabel(context, minTimeLabel.name),
    priorityLabel: minPriority.name,
  };
}

async function handleTimeLabel(context: Context, timeLabels: Label[], estimate: PriorityTimeEstimate): Promise<PricingResult> {
  const { logger } = context;
  const minTimeLabel = getMinTimeLabel(context, timeLabels);
  if (!minTimeLabel) {
    throw logger.error("Could not calculate a valid time from the provided labels.");
  }
  await retainMinimumLabels(context, timeLabels, minTimeLabel);

  const { priority: priorityLabel } = estimate;
  logger.info(`AI estimated priority: "${priorityLabel}"`);
  await createAndAddLabel(context, priorityLabel);
  return {
    timeLabelValue: parseTimeLabel(context, minTimeLabel.name),
    priorityLabel,
  };
}

async function fetchAiEstimates(context: Context): Promise<PriorityTimeEstimate> {
  const { logger, env } = context;
  const issue = getIssueFromPayload(context);
  if (!issue || !issue.body || !issue.title) {
    throw logger.error("No issue found in the payload.");
  }

  if (!env.BASETEN_API_KEY || !env.BASETEN_API_URL) {
    throw logger.error("Missing API credentials for AI estimation.");
  }

  try {
    const estimation = await getPriorityTime(issue.body, issue.title, env.BASETEN_API_KEY, env.BASETEN_API_URL);
    if (!estimation) {
      throw logger.error("AI failed to return an estimate.");
    }
    return estimation;
  } catch (error) {
    throw logger.error("An error occurred while fetching AI estimates:", { err: error });
  }
}

async function createAndAddLabel(context: Context, labelName: string) {
  await createLabel(context, labelName);
  await addLabelToIssue(context, labelName);
}

async function retainMinimumLabels(context: Context, labels: Label[], labelToKeep: Label) {
  const { logger, octokit, payload } = context;
  if (!labelToKeep?.name) {
    logger.warn("No label to keep, skipping.");
    return;
  }
  const issue = getIssueFromPayload(context);
  if (!issue) {
    logger.error("No issue found in the payload.");
    return;
  }
  if (!payload.repository.owner || !payload.repository.owner.login) {
    logger.warn("Repository owner is missing, cannot remove labels.");
    return;
  }
  const toRemove = labels?.filter((l) => l.name !== labelToKeep.name) || [];
  for (const label of toRemove) {
    try {
      await octokit.rest.issues.removeLabel({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: issue.number,
        name: label.name,
      });
      logger.info(`Removed label: ${label.name}`);
    } catch (error) {
      logger.error(`Failed to remove label ${label.name}:`, { err: error });
    }
  }
}

function parseTimeLabel(context: Context, label: string): number {
  const matches = RegExp(/\d+/).exec(label);
  if (!matches) {
    throw context.logger.error(`Could not parse time from label: ${label}`);
  }
  const number = parseInt(matches[0], 10);
  if (isNaN(number)) {
    throw context.logger.error(`Parsed time value is not a number: ${number}`);
  }
  if (label.toLowerCase().includes("minute")) return number * 0.002;
  if (label.toLowerCase().includes("hour")) return number * 0.125;
  if (label.toLowerCase().includes("day")) return 1 + (number - 1) * 0.25;
  if (label.toLowerCase().includes("week")) return number + 1;
  if (label.toLowerCase().includes("month")) return 5 + (number - 1) * 8;
  return 0;
}

function getMinTimeLabel(context: Context, timeLabels: Label[]): Label | null {
  if (!timeLabels || timeLabels.length === 0) {
    return null;
  }

  let minLabel = timeLabels[0];
  let minHours = parseTimeLabel(context, minLabel.name);

  for (const label of timeLabels) {
    const hours = parseTimeLabel(context, label.name);
    if (hours < minHours) {
      minHours = hours;
      minLabel = label;
    }
  }

  return minLabel;
}

function getMinPriorityLabel(context: Context, priorityLabels: Label[]): Label | null {
  if (!priorityLabels || priorityLabels.length === 0) {
    return null;
  }
  let minLabel = priorityLabels[0];
  let minPriority = calculateLabelValue(context, minLabel.name);
  if (minPriority === null) {
    throw context.logger.error(`Could not calculate priority for label: ${minLabel.name}`);
  }
  for (const label of priorityLabels) {
    const priority = calculateLabelValue(context, label.name);
    if (priority === null) {
      throw context.logger.error(`Could not calculate priority for label: ${label.name}`);
    }
    if (priority < minPriority) {
      minPriority = priority;
      minLabel = label;
    }
  }
  return minLabel;
}

function ignoreLabelChange(context: Context, sender: Context["payload"]["sender"], labelName: string): boolean {
  if (context.eventName == "issues.opened" && sender?.type === "Bot" && labelName == context.config.autoLabeling.triggerLabel) {
    context.logger.info(`Ignoring label change event for "${labelName}" on issue opened.`);
    return true;
  }
  if (sender?.type === "Bot" && labelName && (labelName.startsWith("Time:") || labelName.startsWith("Priority:") || labelName.startsWith("Price:"))) {
    context.logger.info(`Ignoring label change event for "${labelName}" from bot.`);
    return true;
  }
  return false;
}

function getIssueFromPayload(context: Context) {
  const eventName = context.eventName;
  if (eventName === "issues.labeled" || eventName === "issues.unlabeled") {
    if (!isIssueLabelEvent(context)) {
      context.logger.debug("Not an issue label event, skipping.");
      return null;
    }
    return context.payload.issue;
  }

  if ("issue" in context.payload && context.payload.issue) {
    return context.payload.issue;
  }

  context.logger.debug("No issue found in the payload.");
  return null;
}

async function processAiEstimation(context: Context, timeLabels: Label[], priorityLabels: Label[]): Promise<void> {
  const estimate = await fetchAiEstimates(context);

  let priceResult;

  //by this point we know priority labels are all valid
  if (priorityLabels.length > 0 && timeLabels.length > 0) {
    // only proceed if "full" mode is enabled
    if (!isValidSetupForAutoPricing(context, "full")) {
      context.logger.warn("Auto pricing is not set up for full mode, skipping.");
      return;
    }
    // in this case time labels are not valid (1 hour, etc)
    priceResult = await handleTimeAndPriorityLabels(context, timeLabels, priorityLabels);
  } else if (priorityLabels.length > 0) {
    priceResult = await handlePriorityLabel(context, priorityLabels, estimate);
  } else if (timeLabels.length > 0) {
    await addLabelToIssue(context, estimate.priority);
    const isTimeLabelValid = timeLabels.every((label) => extractLabelPattern(context.config.labels.time).test(label.name));
    if (isTimeLabelValid) {
      await onLabelChangeSetPricing(context);
      return;
    } else {
      priceResult = await handleTimeLabel(context, timeLabels, estimate);
    }
  } else {
    // only proceed if "full" mode is enabled
    if (!isValidSetupForAutoPricing(context, "full")) {
      context.logger.warn("Auto pricing is not set up for full mode, skipping.");
      return;
    }
    priceResult = await handleNoLabels(context, estimate);
  }

  if (priceResult) {
    await setPrice(context, priceResult);
  }
}

export function isValidSetupForAutoPricing(context: Context, mode: "full" | "partial"): boolean {
  const { config, logger } = context;
  if (!config.autoLabeling.enabled) {
    logger.warn("Auto time estimation is disabled in the configuration.");
    return false;
  }
  if (config.autoLabeling.mode) {
    if (mode === "full" && config.autoLabeling.mode === "partial") {
      logger.warn(`Auto time estimation is set to "partial", but "full" mode is required.`);
      return false;
    }
  }
  return true;
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
  const triggerLabel = context.config.autoLabeling.triggerLabel;
  return labels.some((label) => label.name.toLowerCase().includes(triggerLabel.toLowerCase()));
}
