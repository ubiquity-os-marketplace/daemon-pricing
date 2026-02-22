import { createAppAuth } from "@octokit/auth-app";
import { Value } from "@sinclair/typebox/value";
import { ConfigurationHandler } from "@ubiquity-os/plugin-sdk/configuration";
import { CONFIG_ORG_REPO } from "@ubiquity-os/plugin-sdk/constants";
import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import manifest from "../../manifest.json";
import { isUserAdminOrBillingManager, listOrgRepos, listRepoIssues } from "../shared/issue";
import { logByStatus } from "../shared/logging";
import { COMMIT_MESSAGE } from "../types/constants";
import { Context } from "../types/context";
import { Label } from "../types/github";
import { AssistivePricingSettings, pluginSettingsSchema } from "../types/plugin-input";
import { isPushEvent } from "../types/typeguards";
import { isConfigModified } from "./check-modified-base-rate";
import { getLabelsChanges } from "./get-label-changes";
import { setPriceLabel } from "./pricing-label";
import { syncPriceLabelsToConfig } from "./sync-labels-to-config";
import { normalizeMultilineSecret } from "../utils/secrets";

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

async function getInstallationOctokit(context: Context): Promise<Context["octokit"]> {
  const logger = context.logger;
  const appId = context.env?.APP_ID?.trim() ?? "";
  const appPrivateKey = normalizeMultilineSecret(context.env?.APP_PRIVATE_KEY ?? "");
  const installationId = context.payload.installation?.id ?? Number(context.env?.APP_INSTALLATION_ID ?? "");

  if (!installationId) {
    logger.warn("No installation id found; using default Octokit instance.");
    return context.octokit;
  }

  if (!appId || !appPrivateKey) {
    logger.warn("APP_ID or APP_PRIVATE_KEY missing; using default Octokit instance.");
    return context.octokit;
  }

  return new customOctokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey: appPrivateKey,
      installationId,
    },
  });
}

async function resolveTargetRepos(context: Context, octokit: Context["octokit"]): Promise<Repositories> {
  const { repository } = context.payload;
  if (repository.name === CONFIG_ORG_REPO) {
    return await listOrgRepos({ ...context, octokit } as Context);
  }
  return [repository as Repositories[0]];
}

async function resolveRepoConfig(context: Context, octokit: Context["octokit"], owner: string, repo: string): Promise<AssistivePricingSettings | null> {
  try {
    const handler = new ConfigurationHandler(context.logger, octokit);
    const rawConfig = await handler.getSelfConfiguration(manifest, { owner, repo });
    if (!rawConfig) {
      return null;
    }

    const withDefaults = Value.Default(pluginSettingsSchema, rawConfig);
    return Value.Decode(pluginSettingsSchema, withDefaults);
  } catch (err) {
    context.logger.warn("Failed to fetch configuration for repository", { owner, repo, err });
    return null;
  }
}

async function updatePricingForRepo(context: Context, repository: Repositories[number], config: AssistivePricingSettings, octokit: Context["octokit"]) {
  const repoOwner = repository.owner?.login;
  if (!repoOwner) {
    context.logger.warn("No owner was found in the payload.");
    return;
  }

  const repoContext = {
    ...context,
    config,
    octokit,
    payload: {
      ...context.payload,
      repository,
    },
  } as Context;

  repoContext.logger.info(`Updating pricing labels in ${repository.html_url}`);
  await syncPriceLabelsToConfig(repoContext);
  const issues = await listRepoIssues(repoContext, repoOwner, repository.name);
  for (const issue of issues) {
    if ("pull_request" in issue) {
      continue;
    }
    const ctx = {
      ...repoContext,
      payload: {
        ...repoContext.payload,
        issue,
      },
    } as Context;
    try {
      await setPriceLabel(ctx, issue.labels as Label[], ctx.config);
    } catch (err) {
      logByStatus(repoContext.logger, `Failed to update pricing label for issue #${issue.number}`, err, {
        issueUrl: issue.html_url,
        repo: repository.html_url,
      });
    }
  }
}

async function updateRepoFromConfigChange(context: Context, repository: Repositories[number], octokit: Context["octokit"]) {
  const owner = repository.owner?.login;
  if (!owner) {
    context.logger.warn("No owner found for repository; skipping.", { repository: repository.html_url });
    return;
  }

  const repoConfig = await resolveRepoConfig(context, octokit, owner, repository.name);
  if (!repoConfig) {
    context.logger.debug("No plugin configuration found for repository; skipping.", { repository: repository.html_url });
    return;
  }

  await updatePricingForRepo(context, repository, repoConfig, octokit);
}

async function syncPricingForConfigChange(context: Context) {
  const { logger } = context;
  const installationOctokit = await getInstallationOctokit(context);
  const repositories = await resolveTargetRepos(context, installationOctokit);
  logger.info("Will sync pricing labels in the following list of repositories", {
    repos: repositories.map((repo) => repo.html_url),
  });
  for (const repository of repositories) {
    try {
      await updateRepoFromConfigChange(context, repository, installationOctokit);
    } catch (err) {
      logByStatus(logger, `Could not update pricing labels in ${repository.html_url}`, err);
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
  if (didConfigurationChange) {
    await syncPricingForConfigChange(context);
    return;
  }

  if (context.payload.head_commit?.message !== COMMIT_MESSAGE) {
    logger.debug("The commit name does not match the label update commit message, won't update labels.", {
      url: context.payload.repository.html_url,
    });
    return;
  }

  await updatePricingForRepo(context, context.payload.repository as Repositories[number], context.config, context.octokit);
}
