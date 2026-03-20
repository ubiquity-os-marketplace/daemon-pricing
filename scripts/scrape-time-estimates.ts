/**
 * Scraper: Scrape GitHub issues with Time labels to create JSONL training dataset
 * For OpenAI fine-tuning format
 * 
 * Output format (JSONL):
 * {"messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
 */

import { Octokit } from "@octokit/rest";
import { writeFileSync } from "fs";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!GITHUB_TOKEN) {
  console.error("Set GITHUB_TOKEN or GH_TOKEN");
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

const PARTNER_REPOS = [
  "ubiquity-os-marketplace/text-conversation-rewards",
  "ubiquity-os-marketplace/daemon-pricing",
  "ubiquity-os-marketplace/command-start-stop",
  "ubiquity-os-marketplace/text-vector-embeddings",
  "ubiquity-os-marketplace/daemon-merging",
  "ubiquity-os-marketplace/daemon-disqualifier",
  "ubiquity-os-marketplace/daemon-task-matcher",
  "ubiquity-os-marketplace/daemon-xp",
  "ubiquity-os-marketplace/command-wallet",
  "ubiquity-os-marketplace/command-query",
  "ubiquity-os-marketplace/daemon-spec-rewriter",
  "ubiquity-os-marketplace/command-config",
];

const TIME_LABEL_REGEX = /^Time:\s*(.+)$/i;
const UNIT_TO_MINUTES: Record<string, number> = {
  minute: 1, minutes: 1, min: 1, mins: 1, m: 1,
  hour: 60, hours: 60, hr: 60, hrs: 60, h: 60,
  day: 1440, days: 1440, d: 1440,
  week: 10080, weeks: 10080, wk: 10080, w: 10080,
  month: 43200, months: 43200, mo: 43200, mon: 43200,
};

function parseTimeLabel(label: string): number | null {
  const match = label.match(TIME_LABEL_REGEX);
  if (!match) return null;
  let timeStr = match[1].replace(/^</, "").trim();

  // Handle "1 Day" format
  const durationMatch = timeStr.match(/^(\d+(?:\.\d+)?)\s*(minute|minutes|min|mins|m|hour|hours|hr|hrs|h|day|days|d|week|weeks|wk|w|month|months|mo|mon)$/i);
  if (durationMatch) {
    const value = parseFloat(durationMatch[1]);
    const unit = durationMatch[2].toLowerCase();
    return Math.round(value * (UNIT_TO_MINUTES[unit] || 1440));
  }

  return null;
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + "... [truncated]";
}

interface TrainingEntry {
  messages: {
    role: "system" | "user" | "assistant";
    content: string;
  }[];
}

function createTrainingEntry(
  issueTitle: string,
  issueBody: string,
  comments: string[],
  timeMinutes: number,
  repoName: string,
  labels: string[]
): TrainingEntry {
  const otherLabels = labels.filter(l => !l.startsWith("Time:"));
  
  // Format time in human-readable
  let timeStr: string;
  if (timeMinutes < 60) timeStr = `${timeMinutes} minutes`;
  else if (timeMinutes < 1440) timeStr = `${timeMinutes / 60} hours`;
  else timeStr = `${timeMinutes / 1440} days`;

  const userContent = `## Issue: ${issueTitle}

**Repository**: ${repoName}
**Labels**: ${otherLabels.length > 0 ? otherLabels.join(", ") : "none"}

### Description
${issueBody || "(no description)"}

### Discussion Thread (${comments.length} comments)
${comments.map((c, i) => `**Comment ${i + 1}:**\n${truncateText(c, 500)}`).join("\n\n")}`;

  const assistantContent = `Time estimate: ${timeStr} (${timeMinutes} minutes)`;

  return {
    messages: [
      {
        role: "system",
        content: "You are a task time estimation assistant. Given a GitHub issue with its title, description, and discussion thread, estimate how long the task would take to complete. Provide your estimate in the format: 'Time estimate: X [unit] (Y minutes)'",
      },
      {
        role: "user",
        content: truncateText(userContent, 6000),
      },
      {
        role: "assistant",
        content: assistantContent,
      },
    ],
  };
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchAllComments(owner: string, repo: string, issueNumber: number): Promise<string[]> {
  const comments: string[] = [];
  let page = 1;
  while (true) {
    try {
      const { data } = await octokit.issues.listComments({
        owner, repo, issue_number: issueNumber,
        per_page: 100, page,
      });
      if (data.length === 0) break;
      for (const c of data) {
        comments.push(c.body || "");
      }
      page++;
      if (data.length < 100) break;
      await sleep(1000); // rate limit
    } catch (e) {
      console.error(`  Error fetching comments for ${owner}/${repo}#${issueNumber}: ${e}`);
      break;
    }
  }
  return comments;
}

async function main() {
  console.log("Starting scraper...");
  const entries: TrainingEntry[] = [];
  let totalScanned = 0;
  let skipped = 0;

  for (const repo of PARTNER_REPOS) {
    const [owner, name] = repo.split("/");
    console.log(`\nScanning ${repo}...`);
    
    let page = 1;
    while (true) {
      try {
        const { data } = await octokit.issues.listForRepo({
          owner, repo: name, state: "all",
          per_page: 100, page,
        });
        if (data.length === 0) break;

        for (const issue of data) {
          totalScanned++;
          const timeLabel = issue.labels?.find(l => l.name.startsWith("Time:"));
          if (!timeLabel) continue;

          const timeMinutes = parseTimeLabel(timeLabel.name);
          if (timeMinutes === null || timeMinutes === 0) {
            skipped++;
            continue;
          }

          // Only use closed issues (completed tasks with actual time data)
          if (issue.state !== "closed") {
            skipped++;
            continue;
          }

          const comments = await fetchAllComments(owner, name, issue.number);
          const entry = createTrainingEntry(
            issue.title,
            issue.body || "",
            comments,
            timeMinutes,
            repo,
            issue.labels?.map(l => l.name) || []
          );
          entries.push(entry);
          process.stdout.write(`  Collected ${entries.length} entries...\r`);
        }

        page++;
        if (data.length < 100) break;
        await sleep(1000);
      } catch (e: any) {
        console.error(`  Error on ${repo} page ${page}: ${e.message}`);
        break;
      }
    }
  }

  console.log(`\n\nScan complete!`);
  console.log(`  Total scanned: ${totalScanned}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Collected: ${entries.length}`);

  // Split into training (80%) and validation (20%)
  const shuffled = entries.sort(() => Math.random() - 0.5);
  const splitIdx = Math.floor(shuffled.length * 0.8);
  const training = shuffled.slice(0, splitIdx);
  const validation = shuffled.slice(splitIdx);

  // Write training set
  const trainingPath = "fine_tuning_training.jsonl";
  writeFileSync(trainingPath, training.map(e => JSON.stringify(e)).join("\n") + "\n");
  console.log(`\nTraining set: ${training.length} entries -> ${trainingPath}`);

  // Write validation set
  const validationPath = "fine_tuning_validation.jsonl";
  writeFileSync(validationPath, validation.map(e => JSON.stringify(e)).join("\n") + "\n");
  console.log(`Validation set: ${validation.length} entries -> ${validationPath}`);
  
  // Also write combined file
  const combinedPath = "fine_tuning_data.jsonl";
  writeFileSync(combinedPath, shuffled.map(e => JSON.stringify(e)).join("\n") + "\n");
  console.log(`Combined: ${shuffled.length} entries -> ${combinedPath}`);
}

main().catch(console.error);
