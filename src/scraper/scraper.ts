/**
 * GitHub Issue Scraper - Fetches issues with time labels and converts to structured data
 */

export interface ScrapedIssue {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  timeLabel: string;
  comments: Array<{ author: string; body: string }>;
  url: string;
  createdAt: string;
}

const TIME_LABEL_PATTERNS = [
  /^time:\s*</i,
  /^time\s*</i,
  /^<\d/i,
  /^estimate/i,
  /^effort/i,
  /^complexity/i,
];

export function hasTimeLabel(labels: string[]): boolean {
  return labels.some((label) => TIME_LABEL_PATTERNS.some((p) => p.test(label)));
}

export function extractTimeLabel(labels: string[]): string | null {
  return labels.find((label) => TIME_LABEL_PATTERNS.some((p) => p.test(label))) ?? null;
}

/**
 * Fetch issues from a GitHub repository that have time-related labels.
 */
export async function scrapeIssues(
  owner: string,
  repo: string,
  options: { token?: string; perPage?: number; maxPages?: number } = {}
): Promise<ScrapedIssue[]> {
  const { token, perPage = 100, maxPages = 10 } = options;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const issues: ScrapedIssue[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as Array<Record<string, unknown>>;

    if (data.length === 0) break;

    for (const issue of data) {
      // Skip PRs
      if (issue.pull_request) continue;

      const labels = ((issue.labels as Array<Record<string, unknown>>) ?? []).map((l) =>
        typeof l === "string" ? l : ((l.name as string) ?? "")
      );

      const timeLabel = extractTimeLabel(labels);
      if (!timeLabel) continue;

      // Fetch comments
      const commentsUrl = issue.comments_url as string;
      let comments: Array<{ author: string; body: string }> = [];
      if ((issue.comments as number) > 0 && commentsUrl) {
        try {
          const cRes = await fetch(commentsUrl, { headers });
          if (cRes.ok) {
            const cData = (await cRes.json()) as Array<Record<string, unknown>>;
            comments = cData.map((c) => ({
              author: (c.user as Record<string, unknown>)?.login as string ?? "unknown",
              body: c.body as string ?? "",
            }));
          }
        } catch {
          // Skip comments on error
        }
      }

      issues.push({
        number: issue.number as number,
        title: issue.title as string,
        body: issue.body as string | null,
        labels,
        timeLabel,
        comments,
        url: issue.html_url as string,
        createdAt: issue.created_at as string,
      });
    }
  }

  return issues;
}
