import { Context as PluginContext } from "@ubiquity-os/plugin-sdk";
import { Command } from "./command";
import { Env } from "./env";
import { AssistivePricingSettings } from "./plugin-input";

export type SupportedEvents =
  | "repository.created"
  | "issues.labeled"
  | "issues.unlabeled"
  | "issues.opened"
  | "label.edited"
  | "issue_comment.created"
  | "push";

export type Context<T extends SupportedEvents = SupportedEvents> = PluginContext<AssistivePricingSettings, Env, Command, T>;
