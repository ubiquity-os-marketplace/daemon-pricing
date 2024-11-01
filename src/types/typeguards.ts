import { Context } from "./context";
import { ContextPlugin } from "./plugin-input";

export function isCommentEvent(
  context: ContextPlugin
): context is ContextPlugin & { payload: { issue: Context<"issue_comment">["payload"]["issue"]; comment: Context<"issue_comment">["payload"]["comment"] } } {
  return context.eventName.startsWith("issue_comment.");
}

export function isIssueLabelEvent(context: ContextPlugin): context is ContextPlugin & {
  payload: {
    issue: Context<"issues.labeled" | "issues.unlabeled">["payload"]["issue"];
    label: Context<"issues.labeled" | "issues.unlabeled">["payload"]["label"];
  };
} {
  return context.eventName === "issues.labeled" || context.eventName === "issues.unlabeled";
}

export function isPushEvent(context: ContextPlugin): context is ContextPlugin & { payload: Context<"push">["payload"] } {
  return context.eventName === "push";
}

export function isLabelEditedEvent(context: ContextPlugin): context is ContextPlugin & {
  payload: {
    label: Context<"label.edited">["payload"]["label"];
    changes: Context<"label.edited">["payload"]["changes"];
  };
} {
  return context.eventName === "label.edited";
}
