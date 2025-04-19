import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { createPlugin } from "@ubiquity-os/plugin-sdk";
import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import { Manifest } from "@ubiquity-os/plugin-sdk/manifest";
import { LOG_LEVEL, LogLevel } from "@ubiquity-os/ubiquity-os-logger";
import { Hono } from "hono";
import { handle } from "hono/vercel";
import manifest from "../manifest.json" with { type: "json" };
import { isLocalEnvironment, run } from "../src/run.js";
import { Context, SupportedEvents } from "../src/types/context.js";
import { Env, envSchema } from "../src/types/env.js";
import { AssistivePricingSettings, pluginSettingsSchema } from "../src/types/plugin-input.js";

async function startAction(context: Context, inputs: Record<string, unknown>) {
  const { payload, logger } = context;

  if (!payload.repository.owner) {
    throw logger.fatal("Owner is missing from payload", { payload });
  }

  if (!process.env.ACTION_REF) {
    throw logger.fatal("ACTION_REF is missing from the environment");
  }

  const regex = /^([\w-]+)\/([\w.-]+)@([\w./-]+)$/;

  const match = RegExp(regex).exec(process.env.ACTION_REF);

  if (!match) {
    throw logger.fatal("The ACTION_REF is not in the proper format (owner/repo@ref)", {
      actionRef: process.env.ACTION_REF,
    });
  }

  const [, owner, repo, ref] = match;

  logger.info(`Will try to dispatch a workflow at ${owner}/${repo}@${ref}`);

  const appOctokit = new customOctokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.APP_ID,
      privateKey: process.env.APP_PRIVATE_KEY,
    },
  });

  let authOctokit;
  if (!process.env.APP_ID || !process.env.APP_PRIVATE_KEY) {
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
        appId: process.env.APP_ID,
        privateKey: process.env.APP_PRIVATE_KEY,
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

export const POST = (request: Request) => {
  const responseClone = request.clone();
  const pluginApp = createPlugin<AssistivePricingSettings, Env, null, SupportedEvents>(
    async (context) => {
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
      logLevel: (process.env.LOG_LEVEL as LogLevel) || LOG_LEVEL.INFO,
      kernelPublicKey: process.env.KERNEL_PUBLIC_KEY,
      bypassSignatureVerification: process.env.NODE_ENV === "local",
    }
  );
  const rootApp = new Hono();

  rootApp.route("/api", pluginApp);

  const handler = handle(rootApp);
  return handler(request);
};
