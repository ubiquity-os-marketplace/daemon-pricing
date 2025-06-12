import { autoPricingHandler, checkIfLabelContainsTrigger, onLabelChangeAiEstimation } from "./handlers/auto-pricing.js";
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
          await autoPricingHandler(context);
        }
      }
      break;
    case "issues.labeled":
    case "issues.unlabeled":
      if (isIssueLabelEvent(context) && isWorkerOrLocalEnvironment()) {
        if (checkIfLabelContainsTrigger(context)) {
          logger.info("Label contains trigger, running label change AI pricing handler.");
          await onLabelChangeAiEstimation(context);
        } else {
          logger.info("Label does not contain trigger, running label change set pricing handler.");
          await onLabelChangeSetPricing(context);
        }
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
