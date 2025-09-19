import { isUserAdminOrBillingManager } from "../shared/issue";
import { addLabelToIssue, removeLabelFromIssue } from "../shared/label";
import { Context } from "../types/context";
import { isIssueCommentEvent } from "../types/typeguards";
import { findClosestTimeLabel } from "./time-labels";

// These correspond to getMembershipForUser and getCollaboratorPermissionLevel for a user.
// Anything outside these values is considered to be a contributor (external user).
export const ADMIN_ROLES = ["admin", "owner", "billing_manager"];
export const COLLABORATOR_ROLES = ["write", "member", "collaborator"];

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

  if (orgLogin) {
    try {
      await octokit.rest.orgs.getMembershipForUser({
        org: orgLogin,
        username,
      });
      return true;
    } catch (err) {
      logger.error("Could not get user membership", { err });
    }
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

type Rank = "admin" | "collaborator" | "author" | "contributor";

function rankWeight(rank: Rank) {
  switch (rank) {
    case "admin":
      return 3;
    case "collaborator":
      return 2;
    case "author":
      return 1;
    default:
      return 0;
  }
}

async function getUserRank(context: Context<"issue_comment.created">, username: string): Promise<Rank> {
  const author = context.payload.issue.user.login;
  if (username === author) {
    return "author";
  }
  const admin = await isUserAdminOrBillingManager(context, username);
  if (admin) {
    return "admin";
  }
  const isMember = await isUserAnOrgMember(context, username);
  if (isMember) {
    return "collaborator";
  }
  return "contributor";
}

interface IssueEvent {
  event: string;
  label?: { name?: string } | null;
  actor?: { login?: string } | null;
}

async function getLastTimeLabelSetter(context: Context<"issue_comment.created">): Promise<{ user?: string; rank?: Rank } | null> {
  const owner = context.payload.repository.owner?.login;
  const repo = context.payload.repository.name;
  const issueNumber = context.payload.issue.number;
  if (!owner) return null;
  const events = await context.octokit.paginate(context.octokit.rest.issues.listEvents, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });
  const labeledEvents = (events as IssueEvent[]).filter((e) => e.event === "labeled" && e.label?.name && String(e.label.name).startsWith("Time:")).reverse();
  const last = labeledEvents[0];
  if (!last) return null;
  const user = last.actor?.login as string | undefined;
  if (!user) return { user: undefined, rank: undefined };
  const rank = await getUserRank(context, user);
  return { user, rank };
}

export async function setTimeLabel(context: Context, timeInput: string) {
  if (!isIssueCommentEvent(context)) {
    throw context.logger.warn("The `/time` command can only be used in issue comments.");
  }
  const ctx = context;
  const { payload } = context;

  const sender = payload.sender.login;

  const currentLabels = payload.issue.labels.map((label) => label.name);
  const existingTimeLabels = currentLabels.filter((label: string) => label.startsWith("Time:"));

  async function canSetTimeLabel(): Promise<true | Error> {
    if (existingTimeLabels.length === 0) {
      return true;
    }
    const senderRank = await getUserRank(ctx, sender);
    if (senderRank === "admin" || senderRank === "collaborator") return true;
    if (senderRank === "author") {
      const last = await getLastTimeLabelSetter(ctx);
      if (last?.user && last.user === sender) return true;
      if (last?.rank !== undefined && rankWeight("author") > rankWeight(last.rank)) return true;
      return new Error("Author cannot change time set by a higher or equal rank.");
    }
    return new Error("Contributors cannot change an existing time estimate.");
  }

  const permission = await canSetTimeLabel();
  if (permission instanceof Error) throw permission;

  const timeLabel = await findClosestTimeLabel(ctx, timeInput);
  const timeLabels = currentLabels.filter((label: string) => label.startsWith("Time:"));

  for (const label of timeLabels) {
    await removeLabelFromIssue(ctx, label);
  }
  await addLabelToIssue(ctx, timeLabel);
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
