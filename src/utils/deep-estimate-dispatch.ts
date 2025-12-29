import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import { Context } from "../types/context";

const ACTION_REF_REGEX = /^([\w-]+)\/([\w.-]+)@([\w./-]+)$/;
const DEEP_ESTIMATE_WORKFLOW = "deep-estimate.yml";

type DeepEstimateOptions = {
  trigger: "issues.opened" | "issue_comment.created";
  forceOverride: boolean;
  initiator?: string;
};

async function getDispatchOctokit(context: Context, owner: string, repo: string): Promise<InstanceType<typeof customOctokit> | Octokit> {
  const { APP_ID, APP_PRIVATE_KEY } = context.env;
  if (!APP_ID || !APP_PRIVATE_KEY) {
    context.logger.debug("APP_ID or APP_PRIVATE_KEY is missing; using default Octokit instance for workflow dispatch.");
    return context.octokit;
  }

  const appOctokit = new customOctokit({
    authStrategy: createAppAuth,
    auth: { appId: APP_ID, privateKey: APP_PRIVATE_KEY },
  });

  const installation = await appOctokit.rest.apps.getRepoInstallation({ owner, repo });
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: APP_ID,
      privateKey: APP_PRIVATE_KEY,
      installationId: installation.data.id,
    },
  });
}

function getTargetRepoFullName(context: Context): string {
  const repo = context.payload.repository;
  if (repo?.full_name) return repo.full_name;
  const owner = repo?.owner?.login ?? "";
  const name = repo?.name ?? "";
  return owner && name ? `${owner}/${name}` : "";
}

export async function dispatchDeepEstimate(context: Context, options: DeepEstimateOptions): Promise<void> {
  const { logger, env } = context;
  if (context.authToken.startsWith("gh") && !context.ubiquityKernelToken) {
    logger.warn("Missing ubiquityKernelToken; skipping deep time estimate dispatch.");
    return;
  }
  if (!env.ACTION_REF) {
    logger.debug("ACTION_REF is missing; skipping deep-estimate dispatch.");
    return;
  }

  const match = ACTION_REF_REGEX.exec(env.ACTION_REF);
  if (!match) {
    logger.warn("ACTION_REF is not in the proper format (owner/repo@ref); skipping deep-estimate dispatch.", {
      actionRef: env.ACTION_REF,
    });
    return;
  }

  const [, owner, repo, ref] = match;
  const targetRepo = getTargetRepoFullName(context);
  const issueNumber = "issue" in context.payload ? context.payload.issue?.number : undefined;
  if (!targetRepo || !issueNumber) {
    logger.warn("Missing repository or issue number; skipping deep-estimate dispatch.", { targetRepo, issueNumber });
    return;
  }

  const inputs = {
    repo: targetRepo,
    issueNumber: String(issueNumber),
    authToken: context.authToken,
    ubiquityKernelToken: context.ubiquityKernelToken ?? "",
    installationId: String(context.payload.installation?.id ?? ""),
    forceOverride: options.forceOverride ? "true" : "false",
    trigger: options.trigger,
    initiator: options.initiator ?? context.payload.sender?.login ?? "",
  };

  const dispatchOctokit = await getDispatchOctokit(context, owner, repo);
  await dispatchOctokit.rest.actions.createWorkflowDispatch({
    owner,
    repo,
    ref,
    workflow_id: DEEP_ESTIMATE_WORKFLOW,
    inputs,
  });

  logger.info("Dispatched deep time estimate workflow.", {
    workflow: DEEP_ESTIMATE_WORKFLOW,
    targetRepo,
    issueNumber,
    trigger: options.trigger,
    forceOverride: options.forceOverride,
  });
}
