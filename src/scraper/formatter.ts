/**
 * Formatter - Converts scraped issues into OpenAI fine-tuning message format
 */

import type { ScrapedIssue } from "./scraper";

export interface FineTuneMessage {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

const SYSTEM_PROMPT = "Estimate the time required to complete this GitHub issue.";

export function formatIssue(issue: ScrapedIssue): FineTuneMessage {
  const parts: string[] = [];

  parts.push(`Title: ${issue.title}`);

  if (issue.body) {
    parts.push(`\nDescription:\n${issue.body}`);
  }

  const otherLabels = issue.labels.filter((l) => l !== issue.timeLabel);
  if (otherLabels.length > 0) {
    parts.push(`\nLabels: ${otherLabels.join(", ")}`);
  }

  if (issue.comments.length > 0) {
    const commentText = issue.comments
      .slice(0, 10) // Limit comments to avoid excessive length
      .map((c) => `${c.author}: ${c.body}`)
      .join("\n\n");
    parts.push(`\nComments:\n${commentText}`);
  }

  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: parts.join("\n") },
      { role: "assistant", content: `Time: ${issue.timeLabel}` },
    ],
  };
}

export function formatIssues(issues: ScrapedIssue[]): FineTuneMessage[] {
  return issues.map(formatIssue);
}
