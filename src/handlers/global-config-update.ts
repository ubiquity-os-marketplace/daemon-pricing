import { CONFIG_ORG_REPO } from "@ubiquity-os/plugin-sdk/constants";
import { pushEmptyCommit } from "../shared/commits";
import { isUserAdminOrBillingManager, listOrgRepos, listRepoIssues } from "../shared/issue";
import { logByStatus } from "../shared/logging";
import { COMMIT_MESSAGE } from "../types/constants";
import { Context } from "../types/context";
import { Label } from "../types/github";
import { isPushEvent } from "../types/typeguards";
import { isConfigModified } from "./check-modified-base-rate";
import { getLabelsChanges } from "./get-label-changes";
import { setPriceLabel } from "./pricing-label";
import { syncPriceLabelsToConfig } from "./sync-labels-to-config";

type Repositories = Awaited<ReturnType<typeof listOrgRepos>>;

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
    logger.warn("Pusher is not an admin or billing manager", {
      login: pusher,
    });
  }

  if (!isSenderAuthed) {
    logger.warn("Sender is not an admin or billing manager", {
      login: sender,
    });
  }

  return !!(isPusherAuthed && isSenderAuthed);
}

async function sendEmptyCommits(context: Context<"push">) {
  const {
    logger,
    config: { globalConfigUpdate },
  } = context;

  const repos: Repositories = [];
  const { repository } = context.payload;

  // If the configuration was modified from the configuration repo, chances are we want to update many repository labels
  if (repository.name === CONFIG_ORG_REPO) {
    repos.push(...(await listOrgRepos(context)).filter((repo) => !globalConfigUpdate?.excludeRepos.includes(repo.name)));
  } else {
    // Otherwise the configuration should only impact the hosting repository itself
    repos.push(context.payload.repository as Repositories[0]);
  }

  logger.info("Will send an empty commit to the following list of repositories", { repos: repos.map((repo) => repo.html_url) });
  for (const repository of repos) {
    const ctx = {
      ...context,
      payload: {
        repository: repository,
      },
    } as Context;
    try {
      // Pushing an empty commit will trigger a label update on the repository using its local configuration.
      await pushEmptyCommit(ctx);
    } catch (err) {
      logByStatus(logger, `Could not push an empty commit to ${repository.html_url}`, err);
    }
  }
}

export async function globalLabelUpdate(context: Context) {
  if (!isPushEvent(context)) {
    context.logger.debug("Not a push event");
    return;
  }

  const { logger } = context;

  if (!(await isAuthed(context))) {
    logger.warn("Changes should be pushed and triggered by an admin or billing manager.");
    return;
  }

  const didConfigurationChange = (await isConfigModified(context)) || (await getLabelsChanges(context));

  if (didConfigurationChange && isPushEvent(context)) {
    await sendEmptyCommits(context as Context<"push">);
    return;
  } else if (context.payload.head_commit?.message !== COMMIT_MESSAGE) {
    logger.debug("The commit name does not match the label update commit message, won't update labels.", {
      url: context.payload.repository.html_url,
    });
    return;
  }

  const repository = context.payload.repository;

  logger.info(`Updating pricing labels in ${repository.html_url}`);

  const owner = repository.owner?.login;
  const repo = repository.name;

  if (!owner) {
    throw logger.warn("No owner was found in the payload.");
  }

  await syncPriceLabelsToConfig(context);
  const issues = await listRepoIssues(context, owner, repo);
  for (const issue of issues) {
    const ctx = {
      ...context,
      payload: {
        ...context.payload,
        issue,
      },
    };
    await setPriceLabel(ctx, issue.labels as Label[], ctx.config);
  }
}
