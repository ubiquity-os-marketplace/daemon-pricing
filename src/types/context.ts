import { EmitterWebhookEvent as WebhookEvent } from "@octokit/webhooks";
import { Octokit } from "@octokit/rest";
import { AssistivePricingSettings } from "./plugin-input";
import { createAdapters } from "../adapters";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import { Env } from "./env";

export type SupportedEvents =
  | "repository.created"
  | "issues.labeled"
  | "issues.unlabeled"
  | "issues.opened"
  | "label.edited"
  | "issue_comment.created"
  | "push";

export interface Context<T extends SupportedEvents | "issue_comment" = SupportedEvents> {
  eventName: T;
  payload: WebhookEvent<T>["payload"];
  octokit: InstanceType<typeof Octokit>;
  adapters: ReturnType<typeof createAdapters>;
  config: AssistivePricingSettings;
  logger: Logs;
  env: Env;
}
