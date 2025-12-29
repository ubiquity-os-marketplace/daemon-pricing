import { callLlm, sanitizeLlmResponse } from "@ubiquity-os/plugin-sdk";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { isUserAdminOrBillingManager } from "../shared/issue";
import { addLabelToIssue, createLabel, removeLabelFromIssue } from "../shared/label";
import { logByStatus } from "../shared/logging";
import { Context } from "../types/context";
import { isIssueCommentEvent } from "../types/typeguards";
import { formatDuration, formatTimeLabel, isTimeLabel, parseTimeInput } from "./time-labels";

type IssueContext = Context<"issue_comment.created" | "issues.opened">;

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

  if (orgLogin) {
    try {
      await octokit.rest.orgs.getMembershipForUser({
        org: orgLogin,
        username,
      });
      return true;
    } catch (err) {
      logByStatus(logger, "Could not get user membership", err);
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
  logger.ok(`Retrieved the role for ${username}: ${role}`);
  return getTransformedRole(role) !== "contributor";
}

// Last in the array is the highest rank
const RANK_ORDER = ["contributor", "author", "collaborator", "admin"] as const;
type Rank = (typeof RANK_ORDER)[number];

function rankWeight(rank: Rank) {
  return RANK_ORDER.indexOf(rank);
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

const EXAMPLE_DURATIONS = ["30 minutes", "2 hours", "1 day", "3 days", "1 week", "1 month"];
const MAX_BODY_CHARS = 4000;
const MAX_COMMENT_CHARS = 800;
const MAX_RECENT_COMMENTS = 10;

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function extractLlmDuration(raw: string): string {
  const sanitized = sanitizeLlmResponse(raw);
  const trimmed = sanitized.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const candidate = String(parsed.duration ?? parsed.estimate ?? parsed.time ?? "").trim();
      if (candidate) return candidate;
    } catch {
      // fall back to line parsing
    }
  }

  const firstLine = trimmed.split(/\r?\n/).find((line) => line.trim());
  return firstLine?.trim() ?? "";
}

function normalizeEstimatedDuration(raw: string, logger: Context["logger"]): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw logger.error("LLM returned an empty time estimate.");
  }

  const cleaned = trimmed.replace(/[`*_]/g, "").trim();
  const parsed = parseTimeInput(cleaned);
  if (parsed) {
    return formatDuration(parsed);
  }

  throw logger.error("LLM returned an invalid time estimate.", { estimate: raw });
}

function getExistingTimeLabels(labels: Array<{ name: string }> | undefined): string[] {
  return (labels ?? []).map((label) => label.name).filter((name) => isTimeLabel(name));
}

function trimCommentBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  if (trimmed.length <= MAX_COMMENT_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_COMMENT_CHARS)}...`;
}

async function getRecentHumanComments(context: IssueContext): Promise<Array<{ author: string; body: string }>> {
  const issue = context.payload.issue;
  const commentCount = issue.comments ?? 0;
  if (!commentCount) return [];

  const owner = context.payload.repository.owner?.login;
  if (!owner) return [];

  const perPage = Math.min(MAX_RECENT_COMMENTS, 100);
  const page = Math.max(1, Math.ceil(commentCount / perPage));
  const response = await context.octokit.rest.issues.listComments({
    owner,
    repo: context.payload.repository.name,
    issue_number: issue.number,
    per_page: perPage,
    page,
  });

  const skipId = context.eventName === "issue_comment.created" ? context.payload.comment?.id : undefined;
  const commandRegex = /^\s*\/time\b/i;
  return (response.data ?? [])
    .filter((comment) => comment.user?.type === "User")
    .filter((comment) => !skipId || comment.id !== skipId)
    .map((comment) => ({
      author: comment.user?.login ?? "unknown",
      body: trimCommentBody(String(comment.body ?? "")),
    }))
    .filter((comment) => comment.body && !commandRegex.test(comment.body))
    .slice(-MAX_RECENT_COMMENTS);
}

async function estimateTimeInput(context: IssueContext): Promise<string> {
  const { logger } = context;
  const issue = context.payload.issue;
  const title = issue.title?.trim() ?? "";
  const body = issue.body?.trim() ?? "";
  const trimmedBody = body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}...` : body;
  const optionText = EXAMPLE_DURATIONS.join(", ");
  let recentComments: Array<{ author: string; body: string }> = [];
  try {
    recentComments = await getRecentHumanComments(context);
  } catch (err) {
    logByStatus(logger, "Failed to fetch recent human comments for time estimation.", err);
  }
  const commentsSection = recentComments.length
    ? `Recent human comments (latest ${recentComments.length}):\n${recentComments.map((comment) => `- ${comment.author}: ${comment.body}`).join("\n")}`
    : "";
  const promptBody = [`Issue title:\n${title || "(missing)"}`, `Issue body:\n${trimmedBody || "(missing)"}`, commentsSection].filter(Boolean).join("\n\n");

  let result: ChatCompletion | AsyncIterable<unknown>;
  try {
    result = await callLlm(
      {
        messages: [
          {
            role: "system",
            content:
              "You estimate effort for GitHub issues. Reply with a single duration using minutes, hours, days, weeks, or months. " +
              `Use digits and one unit. No extra text. Examples: ${optionText}.`,
          },
          {
            role: "user",
            content: promptBody,
          },
        ],
        max_tokens: 32,
        temperature: 0.2,
      },
      context
    );
  } catch (err) {
    throw logByStatus(logger, "Failed to estimate time with LLM. Provide a duration like `/time 2 hours`.", err);
  }

  if (isAsyncIterable(result)) {
    throw logger.error("LLM returned an unexpected streaming response.");
  }

  const content = extractLlmDuration((result as ChatCompletion).choices?.[0]?.message?.content ?? "");
  const normalized = normalizeEstimatedDuration(content, logger);
  logger.ok("Estimated time input from LLM", { estimate: content, normalized });
  return normalized;
}

interface IssueEvent {
  event: string;
  label?: { name?: string } | null;
  actor?: { login?: string; type?: string } | null;
  created_at?: string;
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
  const labeledEvents = (events as IssueEvent[])
    .filter((e) => e.event === "labeled" && e.label?.name && String(e.label.name).toLowerCase().startsWith("time:"))
    .reverse();
  const last = labeledEvents[0];
  if (!last) return null;
  const user = last.actor?.login;
  if (!user) return { user: undefined, rank: undefined };
  const isBot = last.actor?.type === "Bot";
  if (!isBot) {
    const rank = await getUserRank(context, user);
    return { user, rank };
  }

  // If a bot applied the label, try to infer the human initiator by scanning the latest '/time' comment before this event
  try {
    const comments = (await context.octokit.paginate(context.octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    })) as Array<{ body?: string; user?: { login?: string }; created_at?: string }>;
    const lastEventTime = last.created_at ? new Date(last.created_at).getTime() : Number.POSITIVE_INFINITY;
    const timeCmdRegex = /^\s*\/time\b/i;
    const initiator = comments
      .filter((c) => c.body && timeCmdRegex.test(c.body) && (!c.created_at || new Date(c.created_at).getTime() <= lastEventTime))
      .slice(-1)[0];
    if (initiator?.user?.login) {
      const rank = await getUserRank(context, initiator.user.login);
      return { user: initiator.user.login, rank };
    }
  } catch {
    // ignore and fallback
  }

  // Fallback: treat bot as the highest rank
  return { user, rank: "admin" };
}

async function ensureTimeLabelExists(context: Context, labelName: string): Promise<void> {
  const owner = context.payload.repository.owner?.login;
  if (!owner) {
    throw context.logger.warn("No owner was found in the payload.");
  }

  if ("issue" in context.payload && context.payload.issue?.labels?.some((label) => label.name === labelName)) {
    return;
  }

  const labels = await context.octokit.paginate(context.octokit.rest.issues.listLabelsForRepo, {
    owner,
    repo: context.payload.repository.name,
    per_page: 100,
  });

  if (!labels.some((label) => label.name === labelName)) {
    await createLabel(context, labelName, "default");
  }
}

export async function setTimeLabel(context: Context, timeInput: string) {
  if (!isIssueCommentEvent(context)) {
    throw context.logger.warn("The `/time` command can only be used in issue comments.");
  }
  const ctx = context;
  const { payload } = context;

  const sender = payload.sender.login;

  const currentLabels = payload.issue.labels.map((label) => label.name);
  const existingTimeLabels = currentLabels.filter((label: string) => label.toLowerCase().startsWith("time:"));

  async function assertCanSetTimeLabel(): Promise<void> {
    if (existingTimeLabels.length === 0) {
      return;
    }
    const senderRank = await getUserRank(ctx, sender);
    if (senderRank === "admin" || senderRank === "collaborator") return;
    if (senderRank === "author") {
      const last = await getLastTimeLabelSetter(ctx);
      if (last?.user && last.user === sender) return;
      if (last?.rank !== undefined && rankWeight("author") > rankWeight(last.rank)) return;
      throw context.logger.warn("Insufficient permissions to change the time estimate.", {
        reason: "author-higher-rank",
        sender,
        senderRank,
        lastSetter: last?.user,
        lastSetterRank: last?.rank,
        existingTimeLabels,
        requestedTimeInput: timeInput,
      });
    }
    throw context.logger.warn("Insufficient permissions to change the time estimate.", {
      reason: "contributor-restriction",
      sender,
      senderRank,
      existingTimeLabels,
      requestedTimeInput: timeInput,
    });
  }

  await assertCanSetTimeLabel();

  const parsedInput = parseTimeInput(timeInput);
  if (!parsedInput) {
    throw context.logger.warn(`The provided time \`${timeInput}\` is invalid.`, { input: timeInput });
  }
  const timeLabel = formatTimeLabel(parsedInput);
  const timeLabels = currentLabels.filter((label: string) => label.toLowerCase().startsWith("time:"));

  for (const label of timeLabels) {
    await removeLabelFromIssue(ctx, label);
  }
  await ensureTimeLabelExists(ctx, timeLabel);
  await addLabelToIssue(ctx, timeLabel);
}

export async function ensureTimeLabelOnIssueOpened(context: Context<"issues.opened">) {
  const { logger } = context;
  const issue = context.payload.issue;
  const existingTimeLabels = getExistingTimeLabels(issue.labels);

  if (existingTimeLabels.length > 0) {
    logger.debug("Skipping time estimation because a time label already exists.", { labels: existingTimeLabels });
    return;
  }

  try {
    const estimatedInput = await estimateTimeInput(context);
    const parsedInput = parseTimeInput(estimatedInput);
    if (!parsedInput) {
      throw logger.error("LLM returned an invalid time estimate.", { estimate: estimatedInput });
    }
    const timeLabel = formatTimeLabel(parsedInput);
    await ensureTimeLabelExists(context, timeLabel);
    await addLabelToIssue(context, timeLabel);
    logger.ok("Added estimated time label to new issue.", { timeLabel, estimate: estimatedInput });
  } catch (err) {
    logByStatus(logger, "Failed to auto-estimate a time label for the new issue.", err);
  }
}

export async function time(context: Context<"issue_comment.created">) {
  const { comment } = context.payload;
  const slashCommand = comment.body.trim().split(" ")[0].replace("/", "");
  if (slashCommand !== "time") {
    context.logger.warn(`The command ${slashCommand} is not supported.`);
    return;
  }
  const commandInput = typeof context.command?.parameters?.duration === "string" ? context.command.parameters.duration.trim() : "";
  const timeInput = commandInput || comment.body.replace(`/${slashCommand}`, "").trim();
  const resolvedInput = timeInput || (await estimateTimeInput(context));
  await setTimeLabel(context, resolvedInput);
}
