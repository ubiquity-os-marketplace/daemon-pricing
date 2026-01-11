import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { createPlugin, Options } from "@ubiquity-os/plugin-sdk";
import { Manifest } from "@ubiquity-os/plugin-sdk/manifest";
import { customOctokit } from "@ubiquity-os/plugin-sdk/octokit";
import { LOG_LEVEL, LogLevel } from "@ubiquity-os/ubiquity-os-logger";
import type { ExecutionContext } from "hono";
import manifest from "../manifest.json";
import { handleCommand, isLocalEnvironment, run } from "./run";
import { logByStatus } from "./shared/logging";
import { Command } from "./types/command";
import { Context, SupportedEvents } from "./types/context";
import { Env, envSchema } from "./types/env";
import { AssistivePricingSettings, pluginSettingsSchema } from "./types/plugin-input";
import { dispatchDeepEstimate } from "./utils/deep-estimate-dispatch";
import { normalizeMultilineSecret } from "./utils/secrets";

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

  const appPrivateKey = normalizeMultilineSecret(context.env.APP_PRIVATE_KEY);

  const appOctokit = new customOctokit({
    authStrategy: createAppAuth,
    auth: {
      appId: context.env.APP_ID,
      privateKey: appPrivateKey,
    },
  });

  let authOctokit;
  if (!env.APP_ID || !appPrivateKey) {
    logger.warn("APP_ID or APP_PRIVATE_KEY are missing from the env, will use the default Octokit instance.");
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
        privateKey: appPrivateKey,
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
              await startAction(context, text);
              if (context.eventName === "issues.opened") {
                try {
                  await dispatchDeepEstimate(context, {
                    trigger: "issues.opened",
                    forceOverride: false,
                    initiator: context.payload.sender?.login,
                  });
                } catch (err) {
                  logByStatus(context.logger, "Failed to dispatch deep time estimate for new issue.", err);
                }
              }
              return { message: "OK" };
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
        envSchema: envSchema as unknown as Options["envSchema"],
        settingsSchema: pluginSettingsSchema as unknown as Options["settingsSchema"],
        postCommentOnError: true,
        logLevel: (env.LOG_LEVEL as LogLevel) || LOG_LEVEL.INFO,
        kernelPublicKey: env.KERNEL_PUBLIC_KEY as string,
        bypassSignatureVerification: process.env.NODE_ENV === "local",
      }
    );

    return app.fetch(request, env, executionCtx);
  },
};
