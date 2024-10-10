import { EmitterWebhookEvent as WebhookEvent, EmitterWebhookEventName as WebhookEventName } from "@octokit/webhooks";
import { StandardValidator } from "typebox-validators";
import { SupportedEvents } from "./context";
import { StaticDecode, Type as T } from "@sinclair/typebox";

export interface PluginInputs<T extends WebhookEventName = SupportedEvents> {
  stateId: string;
  eventName: T;
  eventPayload: WebhookEvent<T>["payload"];
  settings: AssistivePricingSettings;
  authToken: string;
  ref: string;
}

export const pluginSettingsSchema = T.Object(
  {
    labels: T.Object(
      {
        time: T.Array(T.String(), { default: [] }),
        priority: T.Array(T.String(), { default: [] }),
      },
      { default: {} }
    ),
    basePriceMultiplier: T.Number({ default: 1 }),
    fundExternalClosedIssue: T.Boolean({ default: false }),
  },
  { default: {} }
);

export const assistivePricingSchemaValidator = new StandardValidator(pluginSettingsSchema);

export type AssistivePricingSettings = StaticDecode<typeof pluginSettingsSchema>;
