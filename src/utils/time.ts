import { addLabelToIssue, removeLabelFromIssue } from "../shared/label";
import { Context } from "../types/context";
import { isIssueCommentEvent } from "../types/typeguards";
import { findClosestTimeLabel } from "./time-labels";

// These correspond to getMembershipForUser and getCollaboratorPermissionLevel for a user.
// Anything outside these values is considered to be a contributor (external user).
export const ADMIN_ROLES = ["admin", "owner", "billing_manager"];
export const COLLABORATOR_ROLES = ["write", "member", "collaborator", "maintain"];

export function isAdminRole(role: string) {
  return ADMIN_ROLES.includes(role.toLowerCase());
}

export function isCollaboratorRole(role: string) {
  return COLLABORATOR_ROLES.includes(role.toLowerCase());
}

export function getTransformedRole(role: string) {
  role = role.toLowerCase();
  if (isAdminRole(role)) {
    return "admin";
  } else if (isCollaboratorRole(role)) {
    return "collaborator";
  }
  return "contributor";
}

async function isUserAnOrgMember(context: Context, username: string) {
  const { octokit, logger } = context;
  const orgLogin = context.payload.organization?.login;
  const owner = context.payload.repository.owner?.login;

  if (!orgLogin) {
    logger.warn("No organization was found in the payload, cannot determine the user's membership.");
    return false;
  }

  try {
    await octokit.rest.orgs.getMembershipForUser({
      org: orgLogin,
      username,
    });
    return true;
  } catch (err) {
    logger.error("Could not get user membership", { err });
  }

  if (!owner) {
    logger.warn("No owner was found in the repository, cannot determine the user's membership.");
    return false;
  }

  // If we failed to get organization membership, narrow down to the repository role
  const permissionLevel = await octokit.rest.repos.getCollaboratorPermissionLevel({
    username,
    owner,
    repo: context.payload.repository.name,
  });
  const role = permissionLevel.data.role_name?.toLowerCase();
  logger.info(`Retrieved the role for ${username}: ${role}`);
  return getTransformedRole(role) !== "contributor";
}

export async function setTimeLabel(context: Context, timeInput: string) {
  if (!isIssueCommentEvent(context)) {
    throw context.logger.warn("The `/time` command can only be used in issue comments.");
  }
  const { logger, payload } = context;

  const sender = payload.sender.login;
  const issueAuthor = payload.issue.user.login;
  const isAuthor = sender === issueAuthor;
  const isOrgMember = await isUserAnOrgMember(context, sender);

  if (!isAuthor && !isOrgMember) {
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
