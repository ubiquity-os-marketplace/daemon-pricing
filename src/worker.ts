import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { createPlugin } from "@ubiquity-os/plugin-sdk";
import { Manifest } from "@ubiquity-os/plugin-sdk/manifest";
import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import { LOG_LEVEL, LogLevel } from "@ubiquity-os/ubiquity-os-logger";
import type { ExecutionContext } from "hono";
import { env as honoEnv } from "hono/adapter";
import manifest from "../manifest.json";
import { getPricing, getPriorityTime } from "./handlers/get-priority-time";
import { extractLabelPattern } from "./handlers/label-checks";
import { handleCommand, isLocalEnvironment, run } from "./run";
import { Command } from "./types/command";
import { Context, SupportedEvents } from "./types/context";
import { Env, envSchema } from "./types/env";
import { AssistivePricingSettings, pluginSettingsSchema } from "./types/plugin-input";

type LabelPatternInput = Parameters<typeof extractLabelPattern>[0][number];
type RepositoryLabel = { name: string };
type LabeledGroup = { key: string; labels: LabelPatternInput[]; score: number };

async function fetchRepositoryLabels(octokit: Octokit, owner: string, repo: string): Promise<RepositoryLabel[]> {
  const labels = await octokit.paginate(octokit.rest.issues.listLabelsForRepo, {
    owner,
    repo,
    per_page: 100,
  });
  const results: RepositoryLabel[] = [];
  for (const label of labels) {
    if (typeof label.name === "string") {
      results.push({ name: label.name });
    }
  }
  return results;
}

function computeLabelScore(labelName: string) {
  if (/priority/i.test(labelName)) {
    return 2;
  }
  if (/time/i.test(labelName)) {
    return -1;
  }
  if (/price/i.test(labelName)) {
    return -2;
  }
  return 0;
}

function groupLabelsByPattern(labels: RepositoryLabel[]): LabeledGroup[] {
  const map = new Map<string, LabeledGroup>();
  for (const label of labels) {
    const match = /([\S\s]*?)(\d*\.?\d+)([\S\s]*)/.exec(label.name);
    if (!match) {
      continue;
    }
    const key = `${match[1]}|${match[3]}`;
    const score = computeLabelScore(label.name);
    const labelInput = { name: label.name } as LabelPatternInput;
    const existing = map.get(key);
    if (existing) {
      if (!existing.labels.some((entry) => entry.name === labelInput.name)) {
        existing.labels.push(labelInput);
      }
      existing.score = Math.max(existing.score, score);
      continue;
    }
    map.set(key, {
      key,
      labels: [labelInput],
      score,
    });
  }
  return Array.from(map.values());
}

function evaluateLabelGroups(groups: LabeledGroup[], labels: RepositoryLabel[]): number[] | null {
  const sorted = groups.filter((group) => group.labels.length >= 2).sort((a, b) => b.score - a.score || b.labels.length - a.labels.length);
  for (const group of sorted) {
    try {
      const pattern = extractLabelPattern(group.labels as Parameters<typeof extractLabelPattern>[0]);
      const values: number[] = [];
      for (const label of labels) {
        const execResult = pattern.exec(label.name);
        if (!execResult || execResult[1] === undefined) {
          continue;
        }
        const value = Number(execResult[1]);
        if (!Number.isNaN(value)) {
          values.push(value);
        }
      }
      if (values.length === 0) {
        continue;
      }
      const uniqueSorted = Array.from(new Set(values)).sort((a, b) => a - b);
      return uniqueSorted;
    } catch {
      continue;
    }
  }
  return null;
}

async function startAction(context: Context, inputs: Record<string, unknown>) {
  const { payload, logger, env } = context;

  if (!payload.repository.owner) {
    throw logger.fatal("Owner is missing from payload", { payload });
  }

  if (!env.ACTION_REF) {
    throw logger.fatal("ACTION_REF is missing from the environment");
  }

  const regex = /^([\w-]+)\/([\w.-]+)@([\w./-]+)$/;

  const match = RegExp(regex).exec(env.ACTION_REF);

  if (!match) {
    throw logger.fatal("The ACTION_REF is not in the proper format (owner/repo@ref)");
  }

  const [, owner, repo, ref] = match;

  logger.info(`Will try to dispatch a workflow at ${owner}/${repo}@${ref}`);

  const appOctokit = new customOctokit({
    authStrategy: createAppAuth,
    auth: {
      appId: context.env.APP_ID,
      privateKey: context.env.APP_PRIVATE_KEY,
    },
  });

  let authOctokit;
  if (!env.APP_ID || !env.APP_PRIVATE_KEY) {
    logger.debug("APP_ID or APP_PRIVATE_KEY are missing from the env, will use the default Octokit instance.");
    authOctokit = context.octokit;
  } else {
    const installation = await appOctokit.rest.apps.getRepoInstallation({
      owner,
      repo,
    });
    authOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: context.env.APP_ID,
        privateKey: context.env.APP_PRIVATE_KEY,
        installationId: installation.data.id,
      },
    });
  }
  await authOctokit.rest.actions.createWorkflowDispatch({
    owner,
    repo,
    inputs,
    ref,
    workflow_id: "compute.yml",
  });
}

async function getInstallationOctokit(owner: string, repo: string, appId: string, privateKey: string) {
  const appOctokit = new customOctokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
    },
  });
  const installation = await appOctokit.rest.apps.getRepoInstallation({
    owner,
    repo,
  });
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId: installation.data.id,
    },
  });
}

export default {
  async fetch(request: Request, env: Record<string, unknown>, executionCtx?: ExecutionContext) {
    // It is important to clone the request because the body is read within createPlugin as well
    const responseClone = request.clone();

    const app = createPlugin<AssistivePricingSettings, Env, Command, SupportedEvents>(
      async (context) => {
        if (context.command) {
          return handleCommand(context);
        }
        switch (context.eventName) {
          case "issues.opened":
          case "repository.created":
          case "push": {
            if (isLocalEnvironment()) {
              return run(context);
            } else {
              const text = (await responseClone.json()) as Record<string, unknown>;
              return startAction(context, text);
            }
          }
          case "issues.labeled":
          case "issues.unlabeled": {
            return run(context);
          }
          default: {
            return run(context);
          }
        }
      },
      manifest as Manifest,
      {
        envSchema: envSchema,
        postCommentOnError: true,
        settingsSchema: pluginSettingsSchema,
        logLevel: (env.LOG_LEVEL as LogLevel) || LOG_LEVEL.INFO,
        kernelPublicKey: env.KERNEL_PUBLIC_KEY as string,
        bypassSignatureVerification: process.env.NODE_ENV === "local",
      }
    );

    // /time endpoint
    app.post("/time", async (c) => {
      const env = honoEnv(c);
      const { BASETEN_API_KEY, BASE_PRICE_MULTIPLIER, BASETEN_API_URL } = env;
      if (!BASETEN_API_KEY) {
        return c.json({ error: "BASETEN_API_KEY is not set" }, 500);
      } else if (!BASETEN_API_URL) {
        return c.json({ error: "BASETEN_API_URL is not set" }, 500);
      }
      const body = await c.req.json();
      const { issue_description, issue_title } = body as {
        issue_description: string;
        issue_title: string;
      };

      const priorityTimeEstimate = await getPriorityTime(issue_description, issue_title, BASETEN_API_KEY as string, BASETEN_API_URL as string);

      if (!priorityTimeEstimate) {
        return c.json({ error: "No priority time estimate" }, 500);
      }

      const { time, priority } = priorityTimeEstimate;

      const price = getPricing(parseFloat(BASE_PRICE_MULTIPLIER as string), parseFloat(time), priority);

      return c.json({
        time: time,
        priority: priority,
        price: price.toString(),
      });
    });

    app.get("/priorities", async (c) => {
      const env = honoEnv(c);
      const repoParam = c.req.query("repo");
      if (!repoParam) {
        return c.json({ error: "Missing repo parameter" }, 400);
      }
      const match = /^([\w-]+)\/([\w.-]+)$/.exec(repoParam);
      if (!match) {
        return c.json({ error: "Invalid repo format" }, 400);
      }
      const [, owner, repo] = match;
      if (!env.APP_ID || !env.APP_PRIVATE_KEY) {
        return c.json({ error: "GitHub App credentials are not configured" }, 500);
      }
      try {
        const octokit = await getInstallationOctokit(owner, repo, env.APP_ID as string, env.APP_PRIVATE_KEY as string);
        const labels = await fetchRepositoryLabels(octokit, owner, repo);
        const numericLabels = labels.filter((label) => /\d/.test(label.name));
        if (numericLabels.length === 0) {
          return c.json({ error: "Priority labels not found" }, 404);
        }
        const groups = groupLabelsByPattern(numericLabels);
        const results = evaluateLabelGroups(groups, numericLabels);
        if (!results) {
          return c.json({ error: "Priority labels not found" }, 404);
        }
        return c.json({ priorities: results });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
      }
    });

    return app.fetch(request, env, executionCtx);
  },
};
