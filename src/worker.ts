import { createClient } from "@supabase/supabase-js";
import { createPlugin } from "@ubiquity-os/ubiquity-os-kernel";
import type { ExecutionContext } from "hono";
import { createAdapters } from "./adapters";
import { run } from "./run";
import { SupportedEvents } from "./types/context";
import { Env, envSchema } from "./types/env";
import { AssistivePricingSettings, pluginSettingsSchema } from "./types/plugin-input";
import manifest from "../manifest.json";

export default {
  async fetch(request: Request, env: Env, executionCtx?: ExecutionContext) {
    return createPlugin<AssistivePricingSettings, Env, SupportedEvents>(
      (context) => {
        return run({
          ...context,
          adapters: createAdapters(createClient(context.env.SUPABASE_URL, context.env.SUPABASE_KEY), context),
        });
      },
      //@ts-expect-error types are ok
      manifest,
      {
        envSchema: envSchema,
        postCommentOnError: true,
        settingsSchema: pluginSettingsSchema,
        logLevel: env.LOG_LEVEL,
        kernelPublicKey: env.KERNEL_PUBLIC_KEY,
      }
    ).fetch(request, env, executionCtx);
  },
};
