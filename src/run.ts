import { globalLabelUpdate } from "./handlers/global-config-update";
import { watchLabelChange } from "./handlers/label-change";
import { onLabelChangeSetPricing } from "./handlers/pricing-label";
import { syncPriceLabelsToConfig } from "./handlers/sync-labels-to-config";
import { Context } from "./types/context";
import { isIssueLabelEvent } from "./types/typeguards";

export async function run(context: Context) {
  const { eventName, logger } = context;

  switch (eventName) {
    case "issues.opened":
    case "repository.created":
      await syncPriceLabelsToConfig(context);
      break;
    case "issues.labeled":
    case "issues.unlabeled":
      if (isIssueLabelEvent(context)) {
        await syncPriceLabelsToConfig(context);
        await onLabelChangeSetPricing(context);
      }
      break;
    case "label.edited":
      await watchLabelChange(context);
      break;
    case "push":
      await globalLabelUpdate(context);
      break;
    default:
      logger.error(`Event ${eventName} is not supported`);
  }
  return { message: "OK" };
}
