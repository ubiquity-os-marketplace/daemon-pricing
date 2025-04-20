import { clearAllPriceLabelsOnIssue } from "../shared/label.js";
import { calculateLabelValue } from "../shared/pricing.js";
import { Label } from "../types/github.js";
import { Context } from "../types/context.js";

export async function handleParentIssue(context: Context, labels: Label[]) {
  const issuePrices = labels.filter((label) => label.name.toString().startsWith("Price:"));
  if (issuePrices.length) {
    await clearAllPriceLabelsOnIssue(context);
    throw context.logger.warn("Pricing is disabled on parent issues, so the price labels have been cleared.");
  } else if (context.eventName === "issues.labeled") {
    throw context.logger.warn("Pricing is not supported on parent issues, no price will be set.");
  }
}

export function sortLabelsByValue(context: Context, labels: Label[]) {
  return labels.sort((a, b) => {
    return (calculateLabelValue(context, a.name) || 0) - (calculateLabelValue(context, b.name) || 0);
  });
}

export function isParentIssue(body: string) {
  const parentPattern = /-\s+\[([ x])]\s+#\d+/;
  return RegExp(parentPattern).exec(body);
}
