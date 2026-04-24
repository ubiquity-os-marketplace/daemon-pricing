/**
 * CLI entry point for the issue scraper
 */
import { scrapeIssues } from "./scraper";
import { formatIssues } from "./formatter";
import { createDataset } from "./dataset";

async function main() {
  const args = process.argv.slice(2);
  const owner = args[0] || "ubiquity-os-marketplace";
  const repo = args[1] || "daemon-pricing";
  const token = process.env.GITHUB_TOKEN;

  console.log(`Scraping issues from ${owner}/${repo}...`);

  const issues = await scrapeIssues(owner, repo, { token });
  console.log(`Found ${issues.length} issues with time labels.`);

  if (issues.length === 0) {
    console.log("No issues found. Using sample data.");
    return;
  }

  const messages = formatIssues(issues);
  const result = createDataset(messages);

  console.log(`Train: ${result.trainCount} examples → ${result.trainPath}`);
  console.log(`Validation: ${result.validationCount} examples → ${result.validationPath}`);
}

main().catch(console.error);
