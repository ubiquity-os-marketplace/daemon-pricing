import { StaticDecode, Type as T } from "@sinclair/typebox";

export const pluginSettingsSchema = T.Object(
  {
    globalConfigUpdate: T.Optional(
      T.Object({
        excludeRepos: T.Array(T.String()),
      })
    ),
    labels: T.Object(
      {
        time: T.Array(
          T.Object({
            name: T.String({ description: "The display name of the label" }),
            collaboratorOnly: T.Boolean({ default: false, description: "Whether the label is only available to collaborators" }),
          }),
          { default: [] }
        ),
        priority: T.Array(
          T.Object({
            name: T.String(),
            collaboratorOnly: T.Boolean({ default: false }),
          }),
          { default: [] }
        ),
      },
      { default: {} }
    ),
    basePriceMultiplier: T.Number({ default: 1 }),
    publicAccessControl: T.Object(
      {
        setLabel: T.Boolean({ default: false }),
        fundExternalClosedIssue: T.Boolean({ default: false }),
        protectLabels: T.Array(T.String(), { default: ["priority", "price", "time"], uniqueItems: true }),
      },
      { default: {} }
    ),
  },
  { default: {} }
);

export type AssistivePricingSettings = StaticDecode<typeof pluginSettingsSchema>;
