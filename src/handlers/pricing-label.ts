import { addLabelToIssue, clearAllPriceLabelsOnIssue, createLabel, listLabelsForRepo, removeLabelFromIssue } from "../shared/label";
import { labelAccessPermissionsCheck } from "../shared/permissions";
import { getPrice } from "../shared/pricing";
import { Context } from "../types/context";
import { Label, UserType } from "../types/github";
import { AssistivePricingSettings } from "../types/plugin-input";
import { isIssueLabelEvent, isIssueOpenedEvent } from "../types/typeguards";
import { handleParentIssue, isParentIssue, sortLabelsByValue } from "./handle-parent-issue";
import { extractLabelPattern } from "./label-checks";

async function removeUnauthorizedLabel(context: Context) {
  if (!isIssueLabelEvent(context)) {
    context.logger.debug("The event is not an issue label event, cannot remove unauthorized labels.");
    return;
  }
  const owner = context.payload.repository.owner?.login;
  const repo = context.payload.repository.name;
  const issueNumber = context.payload.issue.number;
  const labelToRemove = context.payload.label?.name;
  if (labelToRemove && owner) {
    try {
      await context.octokit.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: issueNumber,
        name: labelToRemove,
      });
      context.logger.info("Removed unauthorized label from issue", { label: labelToRemove });
    } catch (err) {
      context.logger.error("Failed to remove unauthorized label from issue", { err, label: labelToRemove });
    }
  }
}

export async function onIssueOpenedUpdatePricing(context: Context) {
  if (!isIssueOpenedEvent(context)) {
    context.logger.warn("Not an issue transfer event");
    return;
  }

  const newIssue = context.payload.issue;
  const labels = newIssue.labels;

  if (!labels?.length) {
    context.logger.warn("No labels were found to calculate the issue's price.");
    return;
  }
  await updateLabels(context, labels, newIssue);
}

async function updateLabels(
  context: Context,
  labels: Label[],
  issue: Context<"issues.opened" | "issues.labeled" | "issues.unlabeled">["payload"]["issue"],
  label?: Label
) {
  const { payload, logger, config } = context;

  if (!payload.repository.owner?.login) {
    logger.warn("No owner was found in the repository.");
    return;
  }

  if (issue.body && isParentIssue(issue.body)) {
    await handleParentIssue(context, labels);
    return;
  }

  const hasPermission = await labelAccessPermissionsCheck(context);
  if (!hasPermission) {
    if (context.eventName === "issues.labeled" && context.payload.sender?.type !== "Bot") {
      await context.commentHandler.postComment(context, logger.warn("You are not allowed to set labels."));
      await removeUnauthorizedLabel(context);
    }
    return;
  }

  // here we should make an exception if it was a price label that was just set to just skip this action
  const isPayloadToSetPrice = label?.name.includes("Price: ");
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
          owner: payload.repository.owner?.login,
          repo: payload.repository.name,
          issue_number: issue.number,
          name: label.name,
        });
      }
    }

    return;
  }

  await setPriceLabel(context, labels, config);
}

export async function onLabelChangeSetPricing(context: Context): Promise<void> {
  if (!isIssueLabelEvent(context)) {
    context.logger.debug("Not an issue event");
    return;
  }
  const logger = context.logger;
  const payload = context.payload;
  const owner = payload.repository.owner?.login;
  if (!owner) {
    logger.error("No owner found in the repository");
    return;
  }
  const labels = payload.issue.labels;
  if (!labels) {
    logger.info(`No labels to calculate price`);
    return;
  }
  await updateLabels(context, labels, payload.issue, payload.label);
}

export async function setPriceLabel(context: Context, issueLabels: Label[], config: AssistivePricingSettings) {
  const logger = context.logger;
  const labelNames = issueLabels.map((i) => i.name);
  const recognizedLabels = getRecognizedLabels(issueLabels, config);
  const timePattern = extractLabelPattern(context.config.labels.time);
  const priorityPattern = extractLabelPattern(context.config.labels.priority);
  const isPricingAttempt = issueLabels.filter((o) => timePattern.test(o.name) || priorityPattern.test(o.name)).length >= 2;

  if (!recognizedLabels.time.length || !recognizedLabels.priority.length) {
    const message = logger.error("No recognized labels were found to set the price of this task.", {
      repo: context.payload.repository.html_url,
      recognizedLabels,
    });
    // We only want to send that message on labeling, because un-label will trigger this during compute
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

  for (const priorityLabel of recognizedLabels.priority) {
    if (priorityLabel.name !== minLabels.time?.name) {
      await removeLabelFromIssue(context, priorityLabel.name);
    }
  }

  const targetPriceLabel = getPrice(context, minLabels.time, minLabels.priority);

  if (targetPriceLabel) {
    await handleTargetPriceLabel(context, { name: targetPriceLabel, description: null }, labelNames);
    logger.info(`Skipping action...`, {
      repo: context.payload.repository.html_url,
      targetPriceLabel,
    });
  } else {
    await clearAllPriceLabelsOnIssue(context);
    logger.info("Cleared all price labels because target price label is missing.");
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
