import { isUserAdminOrBillingManager, listOrgRepos, listRepoIssues } from "../shared/issue";
import { Label } from "../types/github";
import { ContextPlugin } from "../types/plugin-input";
import { isPushEvent } from "../types/typeguards";
import { isConfigModified } from "./check-modified-base-rate";
import { getBaseRateChanges } from "./get-base-rate-changes";
import { setPriceLabel } from "./pricing-label";
import { syncPriceLabelsToConfig } from "./sync-labels-to-config";

async function isAuthed(context: ContextPlugin): Promise<boolean> {
  if (!isPushEvent(context)) {
    context.logger.debug("Not a push event");
    return false;
  }
  const { payload, logger } = context;

  // who triggered the event
  const sender = payload.sender?.login;
  // who pushed the code
  const pusher = payload.pusher?.name;

  const isPusherAuthed = await isUserAdminOrBillingManager(context, pusher);
  const isSenderAuthed = await isUserAdminOrBillingManager(context, sender);

  if (!isPusherAuthed) {
    logger.error("Pusher is not an admin or billing manager");
  }

  if (!isSenderAuthed) {
    logger.error("Sender is not an admin or billing manager");
  }

  return !!(isPusherAuthed && isSenderAuthed);
}

export async function globalLabelUpdate(context: ContextPlugin) {
  if (!isPushEvent(context)) {
    context.logger.debug("Not a push event");
    return;
  }

  const { logger, config } = context;

  if (!(await isAuthed(context))) {
    logger.error("Changes should be pushed and triggered by an admin or billing manager.");
    return;
  }

  if (!(await isConfigModified(context))) {
    return;
  }

  const rates = await getBaseRateChanges(context);

  if (rates.newBaseRate === null) {
    logger.error("No new base rate found in the diff");
    return;
  }

  logger.info(`Updating base rate from ${rates.previousBaseRate} to ${rates.newBaseRate}`);
  config.basePriceMultiplier = rates.newBaseRate;

  const repos = await listOrgRepos(context);

  for (const repo of repos) {
    const ctx = {
      ...context,
      payload: {
        repository: repo,
      },
    } as ContextPlugin;

    // this should create labels on the repos that are missing
    await syncPriceLabelsToConfig(ctx);
  }

  // update all issues with the new pricing
  if (config.globalConfigUpdate) {
    await updateAllIssuePriceLabels(context);
  }
}

async function updateAllIssuePriceLabels(context: ContextPlugin) {
  const { logger, config } = context;
  const repos = await listOrgRepos(context);

  for (const repo of repos) {
    logger.info(`Fetching issues for ${repo.name}`);
    const issues = await listRepoIssues(context, repo.owner.login, repo.name);

    for (const issue of issues) {
      logger.info(`Updating issue ${issue.number} in ${repo.name}`);
      await setPriceLabel(
        {
          ...context,
          payload: {
            repository: repo,
            issue,
          },
        } as ContextPlugin,
        issue.labels as Label[],
        config
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
