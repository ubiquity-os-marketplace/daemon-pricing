import { isUserAdminOrBillingManager } from "../shared/issue";
import { addLabelToIssue, removeLabelFromIssue } from "../shared/label";
import { Context } from "../types/context";
import { isIssueCommentEvent } from "../types/typeguards";
import { findClosestTimeLabel } from "./time-labels";

async function isUserAnOrgMember(context: Context, username: string) {
  if (!context.payload.organization) return false;

  const { data: membership } = await context.octokit.rest.orgs.getMembershipForUser({
    org: context.payload.organization.login,
    username,
  });

  return membership.role === "member";
}

export async function setTimeLabel(context: Context, timeInput: string) {
  if (!isIssueCommentEvent(context)) {
    throw context.logger.warn("The `/time` command can only be used in issue comments.");
  }
  const { logger, payload } = context;

  const sender = payload.sender.login;
  const issueAuthor = payload.issue.user.login;
  const userAssociation = await isUserAdminOrBillingManager(context, sender);
  const isAdmin = !!userAssociation;
  const isAuthor = sender === issueAuthor;
  const isOrgMember = await isUserAnOrgMember(context, sender);

  if (!isAdmin && !isAuthor && !isOrgMember) {
    throw logger.warn("Only admins, collaborators, or the issue author can set time estimates.");
  }

  const timeLabel = await findClosestTimeLabel(context, timeInput);
  const currentLabels = payload.issue.labels.map((label) => label.name);
  const timeLabels = currentLabels.filter((label: string) => label.startsWith("Time:"));

  for (const label of timeLabels) {
    await removeLabelFromIssue(context, label);
  }
  await addLabelToIssue(context, timeLabel);
}

export async function time(context: Context<"issue_comment.created">) {
  const { comment } = context.payload;
  const slashCommand = comment.body.trim().split(" ")[0].replace("/", "");
  if (slashCommand !== "time") {
    context.logger.warn(`The command ${slashCommand} is not supported.`);
    return;
  }
  const timeInput = comment.body.replace(`/${slashCommand}`, "").trim();
  await setTimeLabel(context, timeInput);
}
