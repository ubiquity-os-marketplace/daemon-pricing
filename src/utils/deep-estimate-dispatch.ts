import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import { Context } from "../types/context";
import { normalizeMultilineSecret } from "./secrets";

const ACTION_REF_REGEX = /^([\w-]+)\/([\w.-]+)@([\w./-]+)$/;
const DEEP_ESTIMATE_WORKFLOW = "deep-estimate.yml";

type DeepEstimateOptions = {
  trigger: "issues.opened" | "issue_comment.created";
  forceOverride: boolean;
  initiator?: string;
};

async function getDispatchOctokit(context: Context, owner: string, repo: string): Promise<InstanceType<typeof customOctokit> | Octokit> {
  const appId = context.env.APP_ID?.trim() ?? "";
  const appPrivateKey = normalizeMultilineSecret(context.env.APP_PRIVATE_KEY);
  if (!appId || !appPrivateKey) {
    const pluginToken = process.env.PLUGIN_GITHUB_TOKEN?.trim();
    if (pluginToken) {
      context.logger.warn("APP_ID or APP_PRIVATE_KEY missing; using PLUGIN_GITHUB_TOKEN for workflow dispatch.");
      return new Octokit({ auth: pluginToken });
    }
    context.logger.warn("APP_ID or APP_PRIVATE_KEY is missing; using default Octokit instance for workflow dispatch.");
    return context.octokit;
  }

  const appOctokit = new customOctokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey: appPrivateKey },
  });

  const installation = await appOctokit.rest.apps.getRepoInstallation({ owner, repo });
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey: appPrivateKey,
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

function getActionRefParts(actionRef: string): { owner: string; repo: string; ref: string } | null {
  const match = ACTION_REF_REGEX.exec(actionRef);
  if (!match) return null;
  const [, owner, repo, ref] = match;
  return { owner, repo, ref };
}

function getDefaultActionRefFromEnv(): { owner: string; repo: string; ref: string } | null {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const ref = process.env.GITHUB_REF_NAME?.trim();
  if (!repository || !ref) return null;
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) return null;
  return { owner, repo, ref };
}

function toBase64(value: string): string {
  if (typeof Buffer !== "undefined") return Buffer.from(value, "utf8").toString("base64");
  if (typeof btoa !== "undefined") return btoa(value);
  throw new Error("Base64 encoding unavailable: neither Buffer nor btoa is defined");
}

export async function dispatchDeepEstimate(context: Context, options: DeepEstimateOptions): Promise<void> {
  const { logger, env } = context;
  const authToken = context.authToken?.trim() ?? "";
  if (authToken.startsWith("gh") && !context.ubiquityKernelToken) {
    logger.warn("Missing ubiquityKernelToken; skipping deep time estimate dispatch.");
    return;
  }
  const actionRefParts = (env.ACTION_REF ? getActionRefParts(env.ACTION_REF) : null) ?? getDefaultActionRefFromEnv();
  if (!actionRefParts) {
    logger.warn("No valid ACTION_REF or GitHub Actions ref found; skipping deep-estimate dispatch.", {
      actionRef: env.ACTION_REF,
      githubRepository: process.env.GITHUB_REPOSITORY,
      githubRefName: process.env.GITHUB_REF_NAME,
    });
    return;
  }

  const { owner, repo, ref } = actionRefParts;
  const targetRepo = getTargetRepoFullName(context);
  const issueNumber = "issue" in context.payload ? context.payload.issue?.number : undefined;
  if (!targetRepo || !issueNumber) {
    logger.warn("Missing repository or issue number; skipping deep-estimate dispatch.", { targetRepo, issueNumber });
    return;
  }

  const authTokenB64 = authToken ? toBase64(authToken) : "";

  const inputs = {
    repo: targetRepo,
    issueNumber: String(issueNumber),
    authToken,
    authTokenB64,
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

  logger.ok("Dispatched deep time estimate workflow.", {
    workflow: DEEP_ESTIMATE_WORKFLOW,
    targetRepo,
    issueNumber,
    trigger: options.trigger,
    forceOverride: options.forceOverride,
  });
}
