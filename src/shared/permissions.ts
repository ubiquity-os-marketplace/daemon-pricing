import { extractLabelPattern } from "../handlers/label-checks";
import { Context } from "../types/context";
import { UserType } from "../types/github";
import { isIssueLabelEvent } from "../types/typeguards";
import { isUserAdminOrBillingManager } from "./issue";

export async function labelAccessPermissionsCheck(context: Context) {
  if (!isIssueLabelEvent(context)) {
    context.logger.debug("Not an issue event");
    return false;
  }
  const { logger, payload, config } = context;
  const { shouldFundContributorClosedIssue } = context.config;
  if (!payload.label?.name) {
    logger.debug("The label has no name.");
    return false;
  }

  if (shouldFundContributorClosedIssue) {
    logger.info("Fund contributor closed issue is enabled for setting labels");
    return true;
  }
  if (payload.sender?.type === UserType.Bot) {
    logger.info("Bot has full control over all labels");
    return true;
  }
  const sender = payload.sender?.login;
  if (!sender) {
    throw logger.error("No sender found in the payload");
  }

  const repo = payload.repository;
  const sufficientPrivileges = await isUserAdminOrBillingManager(context, sender);
  // Determine the time label regex based on config
  const timeRegex = config.autoLabeling.enabled ? /^Time:\s*\d+\s*(hours?|minutes?|seconds?)$/i : extractLabelPattern(context.config.labels.time);
  // Determine the priority label regex based on config
  const priorityRegex = extractLabelPattern(context.config.labels.priority);
  // get text before :
  const match = payload.label?.name?.split(":");
  // Check if the label is an auto-labeling trigger
  const isAutoLabelingTrigger = config.autoLabeling.enabled && payload.label.name.toLowerCase() === config.autoLabeling.triggerLabel;
  // We can ignore custom labels which are not like Label: <value>
  if (match.length <= 1 && !timeRegex.test(payload.label.name) && !priorityRegex.test(payload.label.name) && !isAutoLabelingTrigger) {
    context.logger.debug("The label does not appear to be a recognized label.", {
      label: payload.label,
    });
    return false;
  }
  const labelType = match[0].toLowerCase();

  if (sufficientPrivileges) {
    logger.info("Admin and billing managers have full control over all labels", {
      repo: repo.full_name,
      user: sender,
      labelType,
    });
    return true;
  }
  return false;
}

export async function handlePermissionCheck(context: Context): Promise<boolean> {
  const hasPermission = await labelAccessPermissionsCheck(context);
  console.log("Has permission:", hasPermission);
  if (!hasPermission && context.eventName === "issues.labeled" && context.payload.sender?.type !== "Bot") {
    await context.commentHandler.postComment(context, context.logger.warn("You are not allowed to set labels."));
  }
  return hasPermission;
}
