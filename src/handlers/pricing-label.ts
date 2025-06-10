import { addLabelToIssue, clearAllPriceLabelsOnIssue, createLabel, listLabelsForRepo, removeLabelFromIssue } from "../shared/label";
import { labelAccessPermissionsCheck } from "../shared/permissions";
import { Label, UserType } from "../types/github";
import { calculatePrice, getPrice } from "../shared/pricing";
import { handleParentIssue, isParentIssue, sortLabelsByValue } from "./handle-parent-issue";
import { AssistivePricingSettings } from "../types/plugin-input";
import { isIssueLabelEvent } from "../types/typeguards";
import { Context } from "../types/context";
import { extractLabelPattern } from "./label-checks";
import { getPriorityTime } from "./get-priority-time.js";

export async function onLabelChangeSetPricing(context: Context): Promise<void> {
  if (!isIssueLabelEvent(context)) {
    context.logger.debug("Not an issue event");
    return;
  }
  const config = context.config;
  const logger = context.logger;
  const payload = context.payload;
  const owner = payload.repository.owner?.login;
  logger.info(`Handling label change for issue #${payload.issue.number} in repository ${payload.repository.name}`);
  if (!owner) {
    logger.error("No owner found in the repository");
    return;
  }
  const labels = payload.issue.labels;
  if (!labels) {
    logger.info(`No labels to calculate price`);
    return;
  }

  logger.info(`Labels found: ${labels.map((label) => label.name).join(", ")}`);
  if (payload.issue.body && isParentIssue(payload.issue.body)) {
    logger.info("This is a parent issue, skipping pricing label handling.");
    await handleParentIssue(context, labels);
    return;
  }

  const hasPermission = await labelAccessPermissionsCheck(context);
  if (!hasPermission) {
    if (context.eventName === "issues.labeled" && context.payload.sender?.type !== "Bot") {
      await context.commentHandler.postComment(context, logger.warn("You are not allowed to set labels."));
    }
    return;
  }

  // here we should make an exception if it was a price label that was just set to just skip this action
  const isPayloadToSetPrice = payload.label?.name.includes("Price: ");
  logger.info(`Is payload to set price label: ${isPayloadToSetPrice}`);
  if (isPayloadToSetPrice) {
    logger.info("This is setting the price label directly so skipping the rest of the action.");

    // make sure to clear all other price labels except for the smallest price label.

    const priceLabels = labels.filter((label) => label.name.includes("Price: "));
    const sortedPriceLabels = sortLabelsByValue(context, priceLabels);
    const smallestPriceLabel = sortedPriceLabels.shift();
    const smallestPriceLabelName = smallestPriceLabel?.name;
    if (smallestPriceLabelName) {
      for (const label of sortedPriceLabels) {
        await context.octokit.rest.issues.removeLabel({
          owner,
          repo: payload.repository.name,
          issue_number: payload.issue.number,
          name: label.name,
        });
      }
    }

    return;
  }

  await setPriceLabel(context, labels, config);
}
async function handleAutoPricing(context: Context, issueLabels: Label[], config: AssistivePricingSettings, labelNames: string[]): Promise<void> {
  const logger = context.logger;
  logger.info("Handling auto pricing for issue labels");
  if (!isIssueLabelEvent(context)) {
    logger.error("No issue found in the payload");
    return;
  }
  const recognizedLabels = getRecognizedLabels(issueLabels, config);
  const minLabels = getMinLabels(context, recognizedLabels);

  for (const priorityLabel of recognizedLabels.priority) {
    if (minLabels.priority && priorityLabel.name !== minLabels.priority.name) {
      await removeLabelFromIssue(context, priorityLabel.name);
    }
  }

  const issueDescription = context.payload.issue.body || "";
  const issueTitle = context.payload.issue.title;
  const { BASETEN_API_KEY, BASETEN_API_URL } = context.env;

  if (!BASETEN_API_KEY || !BASETEN_API_URL) {
    logger.error("Baseten API key or URL is not set in the environment variables.");
    return;
  }

  const { time, priority } = await getPriorityTime(issueDescription, issueTitle, BASETEN_API_KEY, BASETEN_API_URL);
  if (!time || !priority) {
    logger.error("No time or priority returned from Baseten API");
    return;
  }

  let pricingLabel;
  if (minLabels.priority) {
    pricingLabel = calculatePrice(context, { name: time }, { name: minLabels.priority.name });
    await createLabel(context, time, "default");
    await addLabelToIssue(context, time);
  } else if (minLabels.time) {
    pricingLabel = calculatePrice(context, { name: time }, { name: minLabels.time.name });
  } else {
    await createLabel(context, time, "default");
    await createLabel(context, priority, "default");
    await addLabelToIssue(context, priority);
    await addLabelToIssue(context, time);
    pricingLabel = calculatePrice(context, { name: time }, { name: priority });
  }

  if (!pricingLabel) {
    logger.error("No pricing label could be calculated.");
    return;
  }

  await handleTargetPriceLabel(context, { name: pricingLabel, description: null }, labelNames);
}

async function handleManualPricing(context: Context, issueLabels: Label[], config: AssistivePricingSettings): Promise<void> {
  const logger = context.logger;
  logger.info("Handling manual pricing for issue labels");
  const recognizedLabels = getRecognizedLabels(issueLabels, config);
  const timePattern = extractLabelPattern(config.labels.time);
  const priorityPattern = extractLabelPattern(config.labels.priority);
  const labelNames = issueLabels.map((i) => i.name);

  const isPricingAttempt = issueLabels.filter((o) => timePattern.test(o.name) || priorityPattern.test(o.name)).length >= 2;

  if (!recognizedLabels.time.length || !recognizedLabels.priority.length) {
    const message = logger.error("No recognized labels were found to set the price of this task.", {
      repo: context.payload.repository.html_url,
      recognizedLabels,
    });
    if (context.eventName === "issues.labeled" && isPricingAttempt) {
      await context.commentHandler.postComment(context, message);
    }
    await clearAllPriceLabelsOnIssue(context);
    return;
  }

  const minLabels = getMinLabels(context, recognizedLabels);

  if (!minLabels.time || !minLabels.priority) {
    logger.error("No label to calculate price", {
      repo: context.payload.repository.html_url,
    });
    return;
  }

  for (const timeLabel of recognizedLabels.time) {
    if (timeLabel.name !== minLabels.time.name) {
      await removeLabelFromIssue(context, timeLabel.name);
    }
  }

  for (const priorityLabel of recognizedLabels.priority) {
    if (priorityLabel.name !== minLabels.priority.name) {
      await removeLabelFromIssue(context, priorityLabel.name);
    }
  }

  const targetPriceLabel = getPrice(context, minLabels.time, minLabels.priority);

  if (targetPriceLabel) {
    await handleTargetPriceLabel(context, { name: targetPriceLabel, description: null }, labelNames);
  }
}

export async function setPriceLabel(context: Context, issueLabels: Label[], config: AssistivePricingSettings) {
  const logger = context.logger;
  const autoPricingTrigger = config.autoLabelingTrigger;
  const isAutoPricing = config.enablePartialAutoEstimation && issueLabels.some((label) => label.name === autoPricingTrigger);
  logger.info(`Auto pricing is ${isAutoPricing ? "enabled" : "disabled"}`);
  if (isAutoPricing) {
    logger.info("Auto pricing is enabled, running auto pricing handler.");
    const labelNames = issueLabels.map((i) => i.name);
    await handleAutoPricing(context, issueLabels, config, labelNames);
  } else {
    await handleManualPricing(context, issueLabels, config);
  }
}

function getRecognizedLabels(labels: Label[], settings: AssistivePricingSettings) {
  function isRecognizedLabel(label: Label, configLabels: string[]) {
    return (typeof label === "string" || typeof label === "object") && configLabels.some((configLabel) => configLabel === label.name);
  }

  const recognizedTimeLabels: Label[] = labels.filter((label: Label) =>
    isRecognizedLabel(
      label,
      settings.labels.time.map((o) => o.name)
    )
  );

  const recognizedPriorityLabels: Label[] = labels.filter((label: Label) =>
    isRecognizedLabel(
      label,
      settings.labels.priority.map((o) => o.name)
    )
  );

  return { time: recognizedTimeLabels, priority: recognizedPriorityLabels };
}

function getMinLabels(context: Context, recognizedLabels: { time: Label[]; priority: Label[] }) {
  const minTimeLabel = sortLabelsByValue(context, recognizedLabels.time).shift();
  const minPriorityLabel = sortLabelsByValue(context, recognizedLabels.priority).shift();

  return { time: minTimeLabel, priority: minPriorityLabel };
}

async function handleTargetPriceLabel(context: Context, targetPriceLabel: Pick<Label, "name" | "description">, labelNames: string[]) {
  const { repository } = context.payload;
  if (repository.name === "devpool-directory") {
    targetPriceLabel.name = targetPriceLabel.name.replace("Price: ", "Pricing: ");
  }
  const _targetPriceLabel = labelNames.find((name) => name.includes(targetPriceLabel.name));

  if (_targetPriceLabel) {
    await handleExistingPriceLabel(context, targetPriceLabel.name);
  } else {
    const allLabels = await listLabelsForRepo(context);
    if (allLabels.filter((i) => i.name.includes(targetPriceLabel.name)).length === 0) {
      await createLabel(context, targetPriceLabel.name, "price");
    }
    await addPriceLabelToIssue(context, targetPriceLabel.name);
  }
}

async function handleExistingPriceLabel(context: Context, targetPriceLabel: string) {
  const logger = context.logger;
  let labeledEvents = await getAllLabeledEvents(context);
  if (!labeledEvents) return logger.error("No labeled events found");

  labeledEvents = labeledEvents.filter((event) => "label" in event && event.label.name.includes("Price"));
  if (!labeledEvents.length) return logger.error("No price labeled events found");

  if (labeledEvents[labeledEvents.length - 1].actor?.type == UserType.User) {
    logger.info(`Skipping... already exists`);
  } else {
    await addPriceLabelToIssue(context, targetPriceLabel);
  }
}

async function addPriceLabelToIssue(context: Context, targetPriceLabel: string) {
  await clearAllPriceLabelsOnIssue(context);
  await addLabelToIssue(context, targetPriceLabel);
}

async function getAllLabeledEvents(context: Context) {
  const events = await getAllIssueEvents(context);
  if (!events) return null;
  return events.filter((event) => event.event === "labeled");
}

async function getAllIssueEvents(context: Context) {
  if (!("issue" in context.payload) || !context.payload.issue) {
    context.logger.debug("Not an issue event");
    return;
  }

  try {
    return await context.octokit.paginate(context.octokit.rest.issues.listEvents, {
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      issue_number: context.payload.issue.number,
      per_page: 100,
    });
  } catch (err: unknown) {
    context.logger.error("Failed to fetch lists of events", { err });
    return [];
  }
}
