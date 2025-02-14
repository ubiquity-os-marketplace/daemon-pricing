import { Context } from "../types/context";
import { UserType } from "../types/github";
import { isIssueLabelEvent } from "../types/typeguards";
import { isUserAdminOrBillingManager } from "./issue";
import { addLabelToIssue, removeLabelFromIssue } from "./label";

export async function labelAccessPermissionsCheck(context: Context) {
  if (!isIssueLabelEvent(context)) {
    context.logger.debug("Not an issue event");
    return false;
  }
  const { logger, payload } = context;
  const { publicAccessControl } = context.config;
  if (!payload.label?.name) return false;

  if (publicAccessControl.setLabel) {
    logger.info("Public access control is enabled for setting labels");
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

  const labelName = payload.label.name;

  // get text before :
  const match = payload.label?.name?.split(":");
  // We can ignore custom labels which are not like Label: <value>
  if (match.length <= 1) return false;
  const labelType = match[0].toLowerCase();

  // event in plain english
  let action;
  if ("action" in payload) {
    action = payload.action;
  } else {
    throw new Error("No action found in payload");
  }

  if (sufficientPrivileges) {
    logger.info("Admin and billing managers have full control over all labels", {
      repo: repo.full_name,
      user: sender,
      labelType,
    });
    return true;
  } else {
    return handleInsufficientPrivileges(context, labelType, sender, repo, action, labelName);
  }
}

async function handleInsufficientPrivileges(
  context: Context,
  labelType: string,
  sender: string,
  repo: Context["payload"]["repository"],
  action: string,
  labelName: string
) {
  const { logger, config, commentHandler } = context;
  logger.info("Checking access for labels", { repo: repo.full_name, user: sender, labelType });

  if (config.publicAccessControl.protectLabels.some((protectedLabel) => protectedLabel.toLowerCase() === labelType.toLowerCase())) {
    await commentHandler.postComment(
      context,
      logger.error(`You do not have permissions to adjust ${config.publicAccessControl.protectLabels.map((label) => `\`${label}\``).join(", ")} labels.`, {
        sender,
        label: labelName,
      })
    );
    if (action === "labeled") {
      await removeLabelFromIssue(context, labelName);
    } else if (action === "unlabeled") {
      await addLabelToIssue(context, labelName);
    }
    return false;
  }

  return true;
}
