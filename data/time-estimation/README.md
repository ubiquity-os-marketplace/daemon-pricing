# Time Estimation Fine-tuning Dataset

OpenAI fine-tuning dataset for training a time estimation model for GitHub issues.

## Dataset

- **Location:** `data/time-estimation/`
- **Train:** 300 examples (`train.jsonl`)
- **Validation:** 87 examples (`validation.jsonl`)
- **Metadata:** `metadata.json`

## Format

OpenAI fine-tuning compatible JSONL:

```json
{"messages": [
  {"role": "system", "content": "You are a time estimation assistant..."},
  {"role": "user", "content": "Issue #123: Title\n\nDescription:\n..."},
  {"role": "assistant", "content": "Time: <1 Day"}
]}
```

## Time Label Distribution

| Label | Count |
|-------|-------|
| Time: <1 Day | 77 |
| Time: <1 Hour | 95 |
| Time: <1 Week | 35 |
| Time: <15 Minutes | 44 |
| Time: <2 Hours | 82 |
| Time: <4 Hours | 54 |

## Regenerate Dataset

The scraper is in `scripts/dataset/scraper.ts`. To regenerate:

```bash
# Install dependencies (from repo root)
bun install

# Run the scraper
bun run scripts/dataset/scraper.ts

# Or with options
GITHUB_TOKEN=your_token bun run scripts/dataset/scraper.ts -- --train-size 300 --val-size 150
```

## Source

Data scraped from: https://github.com/devpool-directory/devpool-directory
