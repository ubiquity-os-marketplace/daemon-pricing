import { globalLabelUpdate } from "./handlers/global-config-update";
import { onIssueOpenedUpdatePricing, onLabelChangeSetPricing } from "./handlers/pricing-label";
import { syncPriceLabelsToConfig } from "./handlers/sync-labels-to-config";
import { Context } from "./types/context";
import { isIssueCommentEvent, isIssueLabelEvent } from "./types/typeguards";
import { dispatchDeepEstimate } from "./utils/deep-estimate-dispatch";
import { ensureTimeLabelOnIssueOpened, time } from "./utils/time";

function isTimeSlashCommand(body: string | null | undefined): boolean {
  return /^\s*\/time\b/i.test(body ?? "");
}

async function maybeDispatchDeepEstimate(context: Context, options: Parameters<typeof dispatchDeepEstimate>[1], message: string) {
  try {
    await dispatchDeepEstimate(context, options);
  } catch (err) {
    context.logger.warn(message, { err });
  }
}

async function handleIssueCommentCreated(context: Context) {
  if (!isWorkerOrLocalEnvironment() || !isIssueCommentEvent(context)) {
    return;
  }
  if (!isTimeSlashCommand(context.payload.comment?.body)) {
    return;
  }
  await time(context);
  await maybeDispatchDeepEstimate(
    context,
    {
      trigger: "issue_comment.created",
      forceOverride: true,
      initiator: context.payload.sender?.login,
    },
    "Failed to dispatch deep time estimate after /time."
  );
}

async function handleIssuesOpened(context: Context) {
  if (!isGithubOrLocalEnvironment()) {
    return;
  }
  await syncPriceLabelsToConfig(context);
  await ensureTimeLabelOnIssueOpened(context);
  await maybeDispatchDeepEstimate(
    context,
    {
      trigger: "issues.opened",
      forceOverride: false,
      initiator: context.payload.sender?.login,
    },
    "Failed to dispatch deep time estimate for new issue."
  );
  await onIssueOpenedUpdatePricing(context);
}

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
    try {
      await dispatchDeepEstimate(context, {
        trigger: "issue_comment.created",
        forceOverride: true,
        initiator: context.payload.sender?.login,
      });
    } catch (err) {
      context.logger.warn("Failed to dispatch deep time estimate after /time.", { err });
    }
  }
}

export async function run(context: Context) {
  if (context.command) {
    await handleCommand(context);
    return { message: "OK" };
  }

  const { eventName, logger } = context;

  switch (eventName) {
    case "issue_comment.created":
      await handleIssueCommentCreated(context);
      break;
    case "issues.opened": {
      await handleIssuesOpened(context);
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
