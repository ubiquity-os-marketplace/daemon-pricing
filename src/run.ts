import { globalLabelUpdate } from "./handlers/global-config-update";
import { onIssueOpenedUpdatePricing, onLabelChangeSetPricing } from "./handlers/pricing-label";
import { syncPriceLabelsToConfig } from "./handlers/sync-labels-to-config";
import { Context } from "./types/context";
import { isIssueCommentEvent, isIssueLabelEvent } from "./types/typeguards";
import { time } from "./utils/time";

export function isLocalEnvironment() {
  return process.env.NODE_ENV === "local";
}

export function isGithubOrLocalEnvironment() {
  return isLocalEnvironment() || !!process.env.GITHUB_ACTIONS;
}

export function isWorkerOrLocalEnvironment() {
  return isLocalEnvironment() || !process.env.GITHUB_ACTIONS;
}

export async function handleCommand(context: Context) {
  if (!context.command) {
    throw new Error("No command found in the context.");
  }

  if (context.command.name === "time" && isIssueCommentEvent(context)) {
    await time(context);
  }
}

export async function run(context: Context) {
  const { eventName, logger } = context;

  switch (eventName) {
    case "issue_comment.created":
      if (isWorkerOrLocalEnvironment() && isIssueCommentEvent(context)) {
        await time(context);
      }
      break;
    case "issues.opened": {
      if (isGithubOrLocalEnvironment()) {
        await syncPriceLabelsToConfig(context);
        await onIssueOpenedUpdatePricing(context);
      }
      break;
    }
    case "repository.created":
      if (isGithubOrLocalEnvironment()) {
        await syncPriceLabelsToConfig(context);
      }
      break;
    case "issues.labeled":
    case "issues.unlabeled":
      if (isIssueLabelEvent(context) && isWorkerOrLocalEnvironment()) {
        await onLabelChangeSetPricing(context);
      }
      break;
    case "push":
      if (isGithubOrLocalEnvironment()) {
        await globalLabelUpdate(context);
      }
      break;
    default:
      logger.error(`Event ${eventName} is not supported`);
  }
  return { message: "OK" };
}
