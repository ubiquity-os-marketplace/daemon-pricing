import { UserType } from "../types/github";
import { ContextPlugin } from "../types/plugin-input";
import { isIssueLabelEvent } from "../types/typeguards";
import { addCommentToIssue, isUserAdminOrBillingManager } from "./issue";
import { addLabelToIssue, removeLabelFromIssue } from "./label";

export async function labelAccessPermissionsCheck(context: ContextPlugin) {
  if (!isIssueLabelEvent(context)) {
    context.logger.debug("Not an issue event");
    return;
  }
  const { logger, payload } = context;
  if (!payload.label?.name) return;

  if (payload.sender.type === UserType.Bot) {
    logger.info("Bot has full control over all labels");
    return true;
  }

  const sender = payload.sender?.login;
  if (!sender) {
    throw logger.error("No sender found in the payload");
  }

  const repo = payload.repository;
  const sufficientPrivileges = await isUserAdminOrBillingManager(context, sender);
  // event in plain english
  let action;
  if ("action" in payload) {
    action = payload.action;
  } else {
    throw new Error("No action found in payload");
  }
  const eventName = action === "labeled" ? "add" : "remove";
  const labelName = payload.label.name;

  // get text before :
  const match = payload.label?.name?.split(":");
  if (match.length == 0) return;
  const labelType = match[0].toLowerCase();

  if (sufficientPrivileges) {
    logger.info("Admin and billing managers have full control over all labels", {
      repo: repo.full_name,
      user: sender,
      labelType,
    });
    return true;
  } else {
    return handleInsufficientPrivileges(context, labelType, sender, repo, action, labelName, eventName);
  }
}

async function handleInsufficientPrivileges(
  context: ContextPlugin,
  labelType: string,
  sender: string,
  repo: ContextPlugin["payload"]["repository"],
  action: string,
  labelName: string,
  eventName: string
) {
  const { logger, payload } = context;
  logger.info("Checking access for labels", { repo: repo.full_name, user: sender, labelType });
  // check permission
  const { access, user } = context.adapters.supabase;
  const userId = await user.getUserId(context, sender);
  const accessible = await access.getAccess(userId, repo.id);
  if (accessible && accessible.labels?.includes(labelType)) {
    return true;
  }

  if (action === "labeled") {
    await removeLabelFromIssue(context, labelName);
  } else if (action === "unlabeled") {
    await addLabelToIssue(context, labelName);
  }

  if ("issue" in payload && payload.issue) {
    await addCommentToIssue(context, `@${sender}, You are not allowed to ${eventName} ${labelName}`, payload.issue.number);
    logger.info("No access to edit label", { sender, label: labelName });
  }

  return false;
}
