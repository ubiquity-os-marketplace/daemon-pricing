import { Context } from "./context";

export function isIssueLabelEvent(context: Context): context is Context & {
  payload: {
    issue: Context<"issues.labeled" | "issues.unlabeled">["payload"]["issue"];
    label: Context<"issues.labeled" | "issues.unlabeled">["payload"]["label"];
  };
} {
  return context.eventName === "issues.labeled" || context.eventName === "issues.unlabeled";
}

export function isIssueOpenedEvent(context: Context): context is Context<"issues.opened"> {
  return context.eventName === "issues.opened";
}

export function isIssueCommentEvent(context: Context): context is Context<"issue_comment.created"> {
  return "issue" in context.payload;
}

export function isPushEvent(context: Context): context is Context & { payload: Context<"push">["payload"] } {
  return context.eventName === "push";
}
