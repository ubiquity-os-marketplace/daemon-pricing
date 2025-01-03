import { createClient } from "@supabase/supabase-js";
import { createPlugin } from "@ubiquity-os/plugin-sdk";
import { LogLevel } from "@ubiquity-os/ubiquity-os-logger";
import type { ExecutionContext } from "hono";
import { createAdapters } from "./adapters";
import { run } from "./run";
import { Context, SupportedEvents } from "./types/context";
import { Env, envSchema } from "./types/env";
import { AssistivePricingSettings, pluginSettingsSchema } from "./types/plugin-input";
import manifest from "../manifest.json";
import { Command } from "./types/command";
import { Manifest } from "@ubiquity-os/plugin-sdk/manifest";

export default {
  async fetch(request: Request, env: Record<string, string>, executionCtx?: ExecutionContext) {
    return createPlugin<AssistivePricingSettings, Env, Command, SupportedEvents>(
      (context) => {
        return run({
          ...context,
          adapters: createAdapters(createClient(context.env.SUPABASE_URL, context.env.SUPABASE_KEY), context as Context),
        });
      },
      manifest as Manifest,
      {
        envSchema: envSchema,
        postCommentOnError: true,
        settingsSchema: pluginSettingsSchema,
        logLevel: (env.LOG_LEVEL as LogLevel) ?? "info",
        kernelPublicKey: env.KERNEL_PUBLIC_KEY,
        bypassSignatureVerification: env.NODE_ENV === "local",
      }
    ).fetch(request, env, executionCtx);
  },
};
