import { autoPricingHandler } from "./handlers/auto-pricing.js";
import { globalLabelUpdate } from "./handlers/global-config-update";
import { onLabelChangeSetPricing } from "./handlers/pricing-label";
import { syncPriceLabelsToConfig } from "./handlers/sync-labels-to-config";
import { Context } from "./types/context";
import { isIssueLabelEvent } from "./types/typeguards";

export function isLocalEnvironment() {
  return process.env.NODE_ENV === "local";
}

export function isGithubOrLocalEnvironment() {
  return isLocalEnvironment() || !!process.env.GITHUB_ACTIONS;
}

export function isWorkerOrLocalEnvironment() {
  return isLocalEnvironment() || !process.env.GITHUB_ACTIONS;
}

export async function run(context: Context) {
  const { eventName, logger, config } = context;

  switch (eventName) {
    case "issues.opened":
    case "repository.created":
      if (isGithubOrLocalEnvironment()) {
        await syncPriceLabelsToConfig(context);
        if (config.enableAutoTimeEstimation) {
          logger.info("Auto pricing enabled, running auto pricing handler.");
          await autoPricingHandler(context as Context<"issues.opened">);
        }
      }
      break;
    case "issues.labeled":
    case "issues.unlabeled":
      logger.info(`Event ${eventName} detected.`);
      if (isIssueLabelEvent(context) && isWorkerOrLocalEnvironment()) {
        logger.info(`Event ${eventName} detected, running label change pricing handler.`);
        await onLabelChangeSetPricing(context);
      } else {
        logger.info(`Event ${eventName} detected, but not running label change pricing handler due to environment.`);
        logger.info(`isIssueLabelEvent: ${isIssueLabelEvent(context)}`);
        logger.info(`isWorkerOrLocalEnvironment: ${isWorkerOrLocalEnvironment()}`);
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
