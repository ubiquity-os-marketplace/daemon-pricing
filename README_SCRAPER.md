# Issue Scraper for Time Estimation

A scraper that creates a JSONL dataset following [OpenAI's fine-tuning specification](https://platform.openai.com/docs/guides/fine-tuning) for estimating time on GitHub issues.

## Purpose

Fine-tune a model to predict how long a GitHub issue will take to complete based on its title, description, labels, and comments.

## Architecture

```
src/scraper/
├── scraper.ts    # Fetch issues from GitHub API, filter by time labels
├── formatter.ts  # Convert issues to OpenAI fine-tune message format
├── dataset.ts    # Split train/validation, write JSONL files
└── cli.ts        # CLI entry point
data/
├── train.jsonl       # Training data (20+ examples)
└── validation.jsonl  # Validation data (5+ examples)
```

## Dataset Format

Each line is a JSON object following OpenAI's chat completion format:

```json
{
  "messages": [
    {"role": "system", "content": "Estimate the time required to complete this GitHub issue."},
    {"role": "user", "content": "Title: ...\nDescription: ...\nLabels: ...\nComments: ..."},
    {"role": "assistant", "content": "Time: <2 Hours"}
  ]
}
```

## Usage

```bash
# Run with defaults (ubiquity-os-marketplace/daemon-pricing)
GITHUB_TOKEN=ghp_... npx tsx src/scraper/cli.ts

# Custom repository
GITHUB_TOKEN=ghp_... npx tsx src/scraper/cli.ts owner repo
```

## Time Labels Recognized

The scraper identifies time labels matching patterns like:
- `Time: <1 Hour`
- `Time: <2 Hours`
- `Time: <1 Day`
- `Time: <3 Days`
- `Time: <1 Week`
- Labels starting with `<` followed by a time estimate
- Labels containing "estimate" or "effort"

## Sample Data

The `data/` directory includes sample JSONL files with realistic GitHub issue examples for immediate fine-tuning experimentation:
- **train.jsonl**: 24 training examples
- **validation.jsonl**: 5 validation examples
