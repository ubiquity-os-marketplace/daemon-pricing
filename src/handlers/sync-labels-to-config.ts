import { COLORS, createLabel, listLabelsForRepo } from "../shared/label";
import { Context } from "../types/context";

// This just checks all the labels in the config have been set in gh issue
// If there's something missing, they will be added

const NO_OWNER_FOUND = "No owner found in the repository!";

export async function syncPriceLabelsToConfig(context: Context): Promise<void> {
  const { logger } = context;
  const owner = context.payload.repository.owner?.login;

  if (!owner) {
    throw logger.warn(NO_OWNER_FOUND);
  }

  const allLabels = await listLabelsForRepo(context);

  const incorrectColorPriceLabels = allLabels.filter((label) => label.name.startsWith("Price: ") && label.color !== COLORS.price);

  // Update incorrect color labels
  if (incorrectColorPriceLabels.length > 0) {
    logger.info("Incorrect color labels found, updating them", { incorrectColorPriceLabels: incorrectColorPriceLabels.map((label) => label.name) });
    await Promise.allSettled(
      incorrectColorPriceLabels.map((label) =>
        context.octokit.rest.issues.updateLabel({
          owner,
          repo: context.payload.repository.name,
          name: label.name,
          color: COLORS.price,
        })
      )
    );
    logger.ok("Updating incorrect color labels done");
  }

  const priorityLabels = context.config.labels.priority.map((label) => label.name);
  const missingPriorityLabels = priorityLabels.filter((name) => !allLabels.some((label) => label.name === name));

  if (missingPriorityLabels.length > 0) {
    logger.info(`Missing priority labels found in ${context.payload.repository.html_url}, creating them`, {
      missingPriorityLabels,
    });
    await Promise.allSettled(missingPriorityLabels.map((label) => createLabel(context, label, "default")));
    logger.ok("Creating missing priority labels done");
  }
}
