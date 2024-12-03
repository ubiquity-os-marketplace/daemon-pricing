import { StaticDecode, Type as T } from "@sinclair/typebox";

export const pluginSettingsSchema = T.Object(
  {
    globalConfigUpdate: T.Optional(
      T.Object({
        excludeRepos: T.Array(T.String(), { examples: ["repo-name", "no-owner-required"], description: "List of repositories to exclude from being updated" }),
      }, { description: "Updates all price labels across all tasks based on `baseRateMultiplier` changes within the config file." }),
    ),
    labels: T.Object(
      {
        time: T.Array(
          T.Object({
            name: T.String({ examples: ["Time: <2 Hours", "Time: <1 Week"], description: "The display name of the label representing estimated task length" }),
            collaboratorOnly: T.Boolean({ default: false, description: "Whether the task is only available for collaborators to be assigned" }),
          }),
          { default: [] }
        ),
        priority: T.Array(
          T.Object({
            name: T.String({ examples: ["Priority: 1 (Normal)", "Priority: 5 (Emergency)"], description: "The display name of the label representing task priority" }),
            collaboratorOnly: T.Boolean({ default: false, description: "Whether the task is only available for collaborators to be assigned" }),
          }),
          { default: [] }
        ),
      },
      { default: {} }
    ),
    basePriceMultiplier: T.Number({ examples: [1.5], default: 1, description: "The base price multiplier for all tasks" }),
    publicAccessControl: T.Object(
      {
        setLabel: T.Boolean({ default: false, description: "Whether to allow anyone to set labels, false to perform permission validation" }),
        fundExternalClosedIssue: T.Boolean({ default: false, description: "Whether to allow funding external closed issues" }),
      },
      { default: {} }
    ),
  },
  { default: {} }
);

export type AssistivePricingSettings = StaticDecode<typeof pluginSettingsSchema>;
