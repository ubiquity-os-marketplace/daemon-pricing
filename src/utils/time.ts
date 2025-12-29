import { callLlm, sanitizeLlmResponse } from "@ubiquity-os/plugin-sdk";
import type { ChatCompletion } from "openai/resources/chat/completions";
import { addLabelToIssue, createLabel, removeLabelFromIssue } from "../shared/label";
import { logByStatus } from "../shared/logging";
import { Context } from "../types/context";
import { isIssueCommentEvent } from "../types/typeguards";
import { formatDuration, formatTimeLabel, isTimeLabel, parseTimeInput } from "./time-labels";

type IssueContext = Context<"issue_comment.created" | "issues.opened">;

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

  const skipId = isIssueCommentEvent(context) ? context.payload.comment?.id : undefined;
  const commandRegex = /^\s*\/time\b/i;
  const comments = (response.data ?? []) as Array<{
    id: number;
    user?: { login?: string | null; type?: string | null } | null;
    body?: string | null;
  }>;
  return comments
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

async function ensureTimeLabelExists(context: Context, labelName: string): Promise<void> {
  const owner = context.payload.repository.owner?.login;
  if (!owner) {
    throw context.logger.warn("No owner was found in the payload.");
  }

  if ("issue" in context.payload && context.payload.issue?.labels?.some((label) => label.name === labelName)) {
    return;
  }

  const labels = (await context.octokit.paginate(context.octokit.rest.issues.listLabelsForRepo, {
    owner,
    repo: context.payload.repository.name,
    per_page: 100,
  })) as Array<{ name: string }>;

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

  const currentLabels = payload.issue.labels.map((label) => label.name);

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
