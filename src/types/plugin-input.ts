import { StaticDecode, Type as T } from "@sinclair/typebox";
import { Context } from "@ubiquity-os/ubiquity-os-kernel";
import { createAdapters } from "../adapters";
import { SupportedEvents } from "./context";
import { Env } from "./env";

export const pluginSettingsSchema = T.Object(
  {
    globalConfigUpdate: T.Optional(
      T.Object({
        excludeRepos: T.Array(T.String()),
      })
    ),
    labels: T.Object(
      {
        time: T.Array(T.String(), { default: [] }),
        priority: T.Array(T.String(), { default: [] }),
      },
      { default: {} }
    ),
    basePriceMultiplier: T.Number({ default: 1 }),
    fundContributorClosedIssue: T.Boolean({ default: false }),
  },
  { default: {} }
);

export type AssistivePricingSettings = StaticDecode<typeof pluginSettingsSchema>;
export type Rates = {
  previousBaseRate: number | null;
  newBaseRate: number | null;
};

export type ContextPlugin = Context<AssistivePricingSettings, Env, SupportedEvents> & { adapters: ReturnType<typeof createAdapters> };
