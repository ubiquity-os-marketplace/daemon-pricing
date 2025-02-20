import { isUserAdminOrBillingManager, listOrgRepos, listRepoIssues } from "../shared/issue";
import { Context } from "../types/context";
import { Label } from "../types/github";
import { isPushEvent } from "../types/typeguards";
import { isConfigModified } from "./check-modified-base-rate";
import { getBaseRateChanges } from "./get-base-rate-changes";
import { getLabelsChanges } from "./get-label-changes";
import { setPriceLabel } from "./pricing-label";
import { syncPriceLabelsToConfig } from "./sync-labels-to-config";

async function isAuthed(context: Context): Promise<boolean> {
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

export async function globalLabelUpdate(context: Context) {
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
  const didLabelsChange = await getLabelsChanges(context);

  if (rates.newBaseRate === null && !didLabelsChange) {
    logger.error("No changes found in the diff, skipping.");
    return;
  }

  if (rates.newBaseRate !== null) {
    logger.info(`Updating base rate from ${rates.previousBaseRate} to ${rates.newBaseRate}`);
    config.basePriceMultiplier = rates.newBaseRate;
  }

  const repos = await listOrgRepos(context);

  for (const repository of repos) {
    const ctx = {
      ...context,
      payload: {
        repository: repository,
      },
    } as Context;

    logger.info(`Updating price labels in ${repository.html_url}`);

    const owner = repository.owner.login;
    const repo = repository.name;
    const issues = await listRepoIssues(context, owner, repo);
    for (const issue of issues) {
      const currentLabels = (
        await context.octokit.paginate(context.octokit.rest.issues.listLabelsOnIssue, {
          owner,
          repo,
          issue_number: issue.number,
        })
      )
        .filter((o) => !o.name.startsWith("Price:"))
        .map((o) => o.name);
      logger.info(`Removing price labels in issue ${issue.html_url}`, { currentLabels });
      if (currentLabels.length) {
        await context.octokit.rest.issues.removeAllLabels({
          owner,
          repo,
          issue_number: issue.number,
        });
        // this should create labels on the repos that are missing
        await syncPriceLabelsToConfig(ctx);
        await context.octokit.rest.issues.addLabels({
          repo,
          owner,
          issue_number: issue.number,
          labels: currentLabels,
        });
      }
    }
  }

  // update all issues with the new pricing
  if (config.globalConfigUpdate) {
    // await updateAllIssuePriceLabels(context);
  }
}

async function updateAllIssuePriceLabels(context: Context) {
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
        } as Context,
        issue.labels as Label[],
        config
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
