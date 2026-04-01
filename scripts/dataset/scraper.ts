#!/usr/bin/env node
/**
 * daemon-pricing Dataset Scraper
 * 
 * Scrapes devpool-directory issues with time estimates and builds
 * an OpenAI fine-tuning compatible JSONL dataset.
 * 
 * Format: https://platform.openai.com/docs/guides/fine-tuning#example-format
 */

import { Octokit } from "@octokit/rest";
import * as fs from "fs";
import * as path from "path";

const SYSTEM_PROMPT = `You are a time estimation assistant for GitHub issues. Given an issue title, description, and discussion thread, estimate the minimum time required to complete the task. Respond with one of the following time labels only: "Time: <15 Minutes", "Time: <1 Hour", "Time: <2 Hours", "Time: <4 Hours", "Time: <1 Day", "Time: <2 Days", "Time: <1 Week". Be conservative and realistic.`;

const TIME_LABELS = [
  "Time: <15 Minutes",
  "Time: <1 Hour",
  "Time: <2 Hours",
  "Time: <4 Hours",
  "Time: <1 Day",
  "Time: <2 Days",
  "Time: <1 Week",
];

const PRICE_LABELS = [
  "Price: 9 USD",
  "Price: 27 USD",
  "Price: 37.5 USD",
  "Price: 75 USD",
  "Price: 150 USD",
  "Price: 300 USD",
  "Price: 450 USD",
  "Price: 600 USD",
  "Price: 900 USD",
  "Price: 1200 USD",
  "Price: 1800 USD",
  "Price: 2400 USD",
];

const DEVPOOL_REPO = "devpool-directory/devpool-directory";

// ─────────────────────────────────────────────────────────────────────────────
// CLI argument parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const args: Record<string, string | number | boolean> = {
    "train-size": 300,
    "val-size": 150,
    "output-dir": "./data",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        if (!isNaN(Number(next))) {
          args[key] = Number(next);
        } else {
          args[key] = next;
        }
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub API helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getDevpoolIssues(octokit: Octokit, page = 1, perPage = 100) {
  process.stderr.write(`Fetching devpool issues page ${page}...\n`);
  const { data: issues } = await octokit.issues.listForRepo({
    owner: "devpool-directory",
    repo: "devpool-directory",
    state: "all",
    per_page: perPage,
    page,
    sort: "created",
    direction: "desc",
  });
  // Filter out PRs and issues without Time labels
  return issues.filter((issue) => {
    if ("pull_request" in issue && issue.pull_request) return false;
    const hasTimeLabel = issue.labels.some((l: any) => {
      const name = typeof l === "string" ? l : l.name;
      return TIME_LABELS.includes(name);
    });
    return hasTimeLabel;
  });
}

async function getAllDevpoolIssues(octokit: Octokit) {
  const allIssues: any[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const issues = await getDevpoolIssues(octokit, page);
    if (issues.length === 0) {
      hasMore = false;
    } else {
      allIssues.push(...issues);
      page++;
      if (page > 50) {
        process.stderr.write("Safety limit: stopping after 50 pages\n");
        break;
      }
    }
  }

  process.stderr.write(`Found ${allIssues.length} issues with time estimates\n`);
  return allIssues;
}

async function getIssueComments(owner: string, repo: string, issueNumber: number, octokit: Octokit) {
  try {
    const { data } = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 50,
    });
    return data;
  } catch {
    return [];
  }
}

async function getIssue(owner: string, repo: string, issueNumber: number, octokit: Octokit) {
  try {
    const { data } = await octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    return data;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dataset building
// ─────────────────────────────────────────────────────────────────────────────

function extractRepoFromBody(body: string | null): { owner: string; repo: string; number: number } | null {
  if (!body) return null;
  const match = body.match(/https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: parseInt(match[3]) };
}

function getLabelValue(labels: any[], candidates: string[]): string {
  for (const label of labels) {
    const name = typeof label === "string" ? label : label.name;
    if (candidates.includes(name)) return name;
  }
  return "";
}

function truncate(text: string, maxChars = 8000): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}

function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

interface Example {
  messages: { role: string; content: string }[];
  time_label: string;
  price_label: string;
  issue_url: string;
}

async function buildExample(issue: any, octokit: Octokit): Promise<Example | null> {
  const timeLabel = getLabelValue(issue.labels, TIME_LABELS);
  const priceLabel = getLabelValue(issue.labels, PRICE_LABELS);

  if (!timeLabel) return null;

  const target = extractRepoFromBody(issue.body);
  if (!target) return null;

  // Rate limit delay
  await new Promise((r) => setTimeout(r, 100));

  const targetIssue = await getIssue(target.owner, target.repo, target.number, octokit);
  if (!targetIssue) {
    process.stderr.write(`  Could not fetch ${target.owner}/${target.repo}#${target.number}\n`);
    return null;
  }

  await new Promise((r) => setTimeout(r, 100));

  const comments = await getIssueComments(target.owner, target.repo, target.number, octokit);

  // Build user content
  let userContent = `Issue #${targetIssue.number}: ${targetIssue.title}\n\n`;
  if (targetIssue.body && targetIssue.body.trim()) {
    userContent += `Description:\n${truncate(targetIssue.body, 4000)}\n\n`;
  }

  if (comments.length > 0) {
    userContent += `Discussion thread (${comments.length} comments):\n`;
    for (const comment of comments.slice(0, 20)) {
      const body = typeof comment.body === "string" ? comment.body : "";
      userContent += `\n[${comment.user?.login || "unknown"} at ${comment.created_at}]:\n${truncate(body, 500)}\n`;
    }
    if (comments.length > 20) {
      userContent += `\n(${comments.length - 20} more comments - truncated)\n`;
    }
  }

  const example: Example = {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: truncate(userContent, 12000) },
      { role: "assistant", content: timeLabel },
    ],
    time_label: timeLabel,
    price_label: priceLabel,
    issue_url: targetIssue.html_url,
  };

  return example;
}

function splitDataset(examples: Example[], trainSize: number): { train: Example[]; val: Example[] } {
  const shuffled = shuffle(examples);
  const train = shuffled.slice(0, Math.min(trainSize, shuffled.length));
  const val = shuffled.slice(trainSize, trainSize + Math.round(trainSize * 0.4));
  return { train, val };
}

function writeJsonl(examples: Example[], filename: string): void {
  const lines = examples.map((ex) => {
    const { messages } = ex;
    return JSON.stringify({ messages });
  });
  const dir = path.dirname(filename);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filename, lines.join("\n") + "\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const trainSize = Number(args["train-size"]) || 300;
  const valSize = Number(args["val-size"]) || 150;
  const outputDir = String(args["output-dir"]) || "./data";

  process.stderr.write(`daemon-pricing dataset scraper\n`);
  process.stderr.write(`Target: ${trainSize} training + ${valSize} validation examples\n`);
  process.stderr.write(`Output directory: ${outputDir}\n\n`);

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    process.stderr.write("ERROR: GITHUB_TOKEN environment variable is required.\n");
    process.stderr.write("Set it with: export GITHUB_TOKEN=your_token\n");
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });

  // Fetch all devpool issues
  const devpoolIssues = await getAllDevpoolIssues(octokit);
  process.stderr.write(`\nFetching target issues from ${devpoolIssues.length} devpool entries...\n`);

  const examples: Example[] = [];
  let processed = 0;

  for (const issue of devpoolIssues) {
    processed++;
    process.stderr.write(`\r  Processed ${processed}/${devpoolIssues.length} (${examples.length} examples built)`);

    try {
      const example = await buildExample(issue, octokit);
      if (example) {
        examples.push(example);
      }
    } catch (err) {
      process.stderr.write(`\n  Error processing issue #${issue.number}: ${err}\n`);
    }
  }

  process.stderr.write(`\n\nBuilt ${examples.length} examples\n`);

  if (examples.length === 0) {
    process.stderr.write("ERROR: No examples scraped. Check your GitHub token and network connection.\n");
    process.exit(1);
  }

  // Split dataset
  const { train, val } = splitDataset(examples, trainSize);
  process.stderr.write(`Training: ${train.length}, Validation: ${val.length}\n`);

  // Write output
  writeJsonl(train, path.join(outputDir, "train.jsonl"));
  writeJsonl(val, path.join(outputDir, "validation.jsonl"));

  // Write metadata
  const meta = {
    total_examples: examples.length,
    train_size: train.length,
    val_size: val.length,
    time_labels: TIME_LABELS,
    scraped_at: new Date().toISOString(),
    source: `https://github.com/${DEVPOOL_REPO}`,
  };
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "metadata.json"),
    JSON.stringify(meta, null, 2)
  );

  process.stderr.write(`\nDone! Files written to ${outputDir}/:\n`);
  process.stderr.write(`  - train.jsonl (${train.length} examples)\n`);
  process.stderr.write(`  - validation.jsonl (${val.length} examples)\n`);
  process.stderr.write(`  - metadata.json\n`);

  // Print label distribution
  const labelDist: Record<string, number> = {};
  for (const ex of examples) {
    labelDist[ex.time_label] = (labelDist[ex.time_label] || 0) + 1;
  }
  process.stderr.write("\nTime label distribution:\n");
  for (const [label, count] of Object.entries(labelDist).sort()) {
    process.stderr.write(`  ${label}: ${count}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
