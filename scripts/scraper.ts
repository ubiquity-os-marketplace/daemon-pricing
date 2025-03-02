import type { RestEndpointMethodTypes } from "@octokit/rest";
type Issue = RestEndpointMethodTypes["issues"]["listForRepo"]["response"]["data"][0];
type PullRequest = RestEndpointMethodTypes["pulls"]["list"]["response"]["data"][0];
import crypto from "crypto";
import { Octokit } from "@octokit/rest";
import dotenv from "dotenv";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";

const logger = new Logs("info");

dotenv.config();

const TIME_BUFFERS = {
  COMMIT: 15,
  COMMENT: 5,
  OTHER: 1,
};

const repositories: RepoConfig[] = [
  {
    owner: "ubiquity-os-marketplace",
    repos: [
      "text-conversation-rewards",
      "command-start-stop",
      "text-vector-embeddings",
      "command-wallet",
      "daemon-pricing",
      "daemon-disqualifier",
      "command-query",
      "command-ask",
    ],
  },
  {
    owner: "ubiquity-os",
    repos: ["plugin-sdk", "ubiquity-os-plugin-installer", "ubiquity-os-kernel"],
  },
  {
    owner: "ubiquity",
    repos: ["pay.ubq.fi", "work.ubq.fi", "ubiquity-dollar"],
  },
];

const TRAIN_SPLIT = 0.8;

interface RepoConfig {
  owner: string;
  repos: string[];
}

interface IssueWithComments extends Issue {
  issueComments?: Array<{
    user: { login: string };
    created_at: string;
    body: string;
  }>;
  number: number;
  title: string;
  body: string;
  created_at: string;
  closed_at: string | null;
  labels: Array<{ name: string }>;
}

interface PullRequestGraphQlResponse {
  repository: {
    pullRequest: {
      title: string;
      assignees: ConnectionNodes<{ login: string }>;
      commits?: ConnectionNodes<CommitNode>;
      comments?: ConnectionNodes<CommentNode>;
      closingIssuesReferences: {
        nodes: Array<{
          number: number;
          title: string;
          body: string;
          createdAt: string;
          closedAt: string | null;
          labels: {
            nodes: Array<{ name: string }>;
          };
          comments: {
            nodes: Array<{
              createdAt: string;
              author: { login: string };
              body: string;
            }>;
          };
        }>;
      };
    };
  };
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface CommitNode {
  commit: {
    committedDate: string;
    author: {
      user?: {
        login: string;
      } | null;
    };
  };
}

interface CommentNode {
  createdAt: string;
  author: {
    login: string;
  };
}

interface ConnectionNodes<T> {
  nodes: T[];
  pageInfo: PageInfo;
}

interface TimeEvent {
  type: "COMMIT" | "COMMENT" | "OTHER";
  timestamp: Date;
}

interface TrainingExample {
  messages: Array<{
    role: string;
    content: string;
  }>;
  timeLabel: string;
  source: string;
}

interface GitHubError extends Error {
  status?: number;
}

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
  request: {
    cache: new Map(),
  },
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkRepoAccess(
  owner: string,
  repo: string
): Promise<{
  exists: boolean;
  private?: boolean;
  message?: string;
}> {
  try {
    const response = await octokit.repos.get({
      owner,
      repo,
    });
    return {
      exists: true,
      private: response.data.private,
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        exists: false,
        message: error.message,
      };
    }
    throw error;
  }
}

async function fetchMergedPullRequests(owner: string, repo: string): Promise<PullRequest[]> {
  let allPullRequests: PullRequest[] = [];
  let page = 1;
  const perPage = 100;
  try {
    logger.info(`\nFetching merged PRs for ${owner}/${repo}...`);

    const repoStatus = await checkRepoAccess(owner, repo);
    if (!repoStatus.exists) {
      console.error(`Repository ${owner}/${repo} not found: ${repoStatus.message}`);
      return [];
    }
    let hasNextPage = true;
    while (hasNextPage) {
      try {
        logger.info(`Fetching page ${page}...`);

        const response = await octokit.search.issuesAndPullRequests({
          q: `repo:${owner}/${repo} is:pr is:merged sort:created-asc`,
          per_page: perPage,
          page,
        });

        logger.info(`Found ${response.data.items.length} PRs, rate limit remaining: ${response.headers["x-ratelimit-remaining"]}`);

        allPullRequests = allPullRequests.concat(response.data.items as unknown as PullRequest[]);

        const link = response.headers.link;
        hasNextPage = link?.includes('rel="next"') ?? false;
        page++;

        await sleep(1000);
      } catch (error) {
        if (error instanceof Error) {
          console.error(`Error fetching page ${page} for ${owner}/${repo}:`, error.message);
          const gitHubError = error as GitHubError;
          if (gitHubError.status === 404) {
            console.error("Repository not found or no access");
            return [];
          }
          throw error;
        }
        throw new Error("An unknown error occurred");
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error in fetchMergedPullRequests for ${owner}/${repo}:`, error.message);
    }
    return [];
  }

  return allPullRequests;
}

interface PullRequestWithLinkedIssues {
  commits: CommitNode[];
  comments: CommentNode[];
  assignees: Array<{ login: string }>;
  title: string;
  linkedIssues: IssueWithComments[];
}

async function getAssignees(
  owner: string,
  repo: string,
  prNumber: number
): Promise<{
  assignees: Array<{ login: string }>;
  title: string;
}> {
  const assigneesQuery = `
    query($owner: String!, $repo: String!, $prNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $prNumber) {
          title
          assignees(first: 100) {
            nodes {
              login
            }
          }
          closingIssuesReferences(first: 50) {
            nodes {
              number
              assignees(first: 100) {
                nodes {
                  login
                }
              }
            }
          }
        }
      }
    }
  `;

  const assigneesResponse = await octokit.graphql<{
    repository: {
      pullRequest: {
        title: string;
        assignees: ConnectionNodes<{ login: string }>;
        closingIssuesReferences: {
          nodes: Array<{
            number: number;
            assignees: ConnectionNodes<{ login: string }>;
          }>;
        };
      };
    };
  }>(assigneesQuery, {
    owner,
    repo,
    prNumber,
  });

  const allAssigneesSet = new Set<string>();

  assigneesResponse.repository.pullRequest.assignees.nodes.forEach((a) => allAssigneesSet.add(a.login));

  assigneesResponse.repository.pullRequest.closingIssuesReferences.nodes.forEach((issue) => issue.assignees.nodes.forEach((a) => allAssigneesSet.add(a.login)));

  return {
    assignees: Array.from(allAssigneesSet).map((login) => ({ login })),
    title: assigneesResponse.repository.pullRequest.title,
  };
}

async function getPullRequestDetailsAndLinkedIssues(
  owner: string,
  repo: string,
  prNumber: string,
  assigneeLogins: string[]
): Promise<PullRequestWithLinkedIssues> {
  let allCommits: CommitNode[] = [];
  let allComments: CommentNode[] = [];
  let linkedIssues: IssueWithComments[] = [];

  try {
    const { assignees, title } = await getAssignees(owner, repo, parseInt(prNumber));

    const dataQuery = `
      query($owner: String!, $repo: String!, $prNumber: Int!, $commitsCursor: String, $commentsCursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $prNumber) {
            commits(first: 100, after: $commitsCursor) {
              nodes {
                commit {
                  committedDate
                  author {
                    user {
                      login
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
            comments(first: 100, after: $commentsCursor) {
              nodes {
                createdAt
                author {
                  login
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
            closingIssuesReferences(first: 50) {
              nodes {
                number
                title
                body
                createdAt
                closedAt
                labels(first: 100) {
                  nodes {
                    name
                  }
                }
                comments(first: 100) {
                  nodes {
                    createdAt
                    author {
                      login
                    }
                    body
                  }
                }
              }
            }
          }
        }
      }
    `;

    const response = await octokit.graphql<PullRequestGraphQlResponse>(dataQuery, {
      owner,
      repo,
      prNumber: parseInt(prNumber),
      commitsCursor: null,
      commentsCursor: null,
    });

    const pr = response.repository.pullRequest;

    if (pr.commits) {
      allCommits = pr.commits.nodes.filter((node) => node.commit.author.user?.login && assigneeLogins.includes(node.commit.author.user.login));
    }

    if (pr.comments) {
      allComments = pr.comments.nodes.filter((node) => assigneeLogins.includes(node.author.login));
    }

    const issueRefs = pr.closingIssuesReferences.nodes;
    linkedIssues = issueRefs.map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      created_at: issue.createdAt,
      closed_at: issue.closedAt,
      labels: issue.labels.nodes.map((label) => ({ name: label.name })),
      issueComments: issue.comments.nodes
        .filter((comment) => assigneeLogins.includes(comment.author.login))
        .map((comment) => ({
          user: { login: comment.author.login },
          created_at: comment.createdAt,
          body: comment.body,
        })),
    })) as IssueWithComments[];

    // Handle pagination
    const { commits: paginatedCommits } = await handleCommitsPagination(owner, repo, parseInt(prNumber), pr, assigneeLogins);
    const { comments: paginatedComments } = await handleCommentsPagination(owner, repo, parseInt(prNumber), pr, assigneeLogins);

    allCommits = [...allCommits, ...paginatedCommits];
    allComments = [...allComments, ...paginatedComments];

    return {
      commits: allCommits,
      comments: allComments,
      assignees,
      title,
      linkedIssues,
    };
  } catch (error) {
    console.error(`Error fetching PR data for ${owner}/${repo}#${prNumber}:`, error);
    return {
      commits: [],
      comments: [],
      assignees: [],
      title: "",
      linkedIssues: [],
    };
  }
}

async function handleCommitsPagination(
  owner: string,
  repo: string,
  prNumber: number,
  pr: PullRequestGraphQlResponse["repository"]["pullRequest"],
  assigneeLogins: string[]
): Promise<{ commits: CommitNode[] }> {
  const additionalCommits: CommitNode[] = [];
  let hasNextPage = pr.commits?.pageInfo.hasNextPage || false;
  let cursor = pr.commits?.pageInfo.endCursor || null;

  while (hasNextPage && cursor) {
    await sleep(1000);
    const commitsQuery = `
      query($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $prNumber) {
            commits(first: 100, after: $cursor) {
              nodes {
                commit {
                  committedDate
                  author {
                    user {
                      login
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }
    `;

    const response = await octokit.graphql<PullRequestGraphQlResponse>(commitsQuery, {
      owner,
      repo,
      prNumber,
      cursor,
    });

    if (response.repository.pullRequest.commits) {
      const filteredCommits = response.repository.pullRequest.commits.nodes.filter(
        (node) => node.commit.author.user?.login && assigneeLogins.includes(node.commit.author.user.login)
      );
      additionalCommits.push(...filteredCommits);
      hasNextPage = response.repository.pullRequest.commits.pageInfo.hasNextPage;
      cursor = response.repository.pullRequest.commits.pageInfo.endCursor;
    } else {
      hasNextPage = false;
    }
  }

  return { commits: additionalCommits };
}

async function handleCommentsPagination(
  owner: string,
  repo: string,
  prNumber: number,
  pr: PullRequestGraphQlResponse["repository"]["pullRequest"],
  assigneeLogins: string[]
): Promise<{ comments: CommentNode[] }> {
  const additionalComments: CommentNode[] = [];
  let hasNextPage = pr.comments?.pageInfo.hasNextPage || false;
  let cursor = pr.comments?.pageInfo.endCursor || null;

  while (hasNextPage && cursor) {
    await sleep(1000);
    const commentsQuery = `
      query($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $prNumber) {
            comments(first: 100, after: $cursor) {
              nodes {
                createdAt
                author {
                  login
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }
    `;

    const response = await octokit.graphql<PullRequestGraphQlResponse>(commentsQuery, {
      owner,
      repo,
      prNumber,
      cursor,
    });

    if (response.repository.pullRequest.comments) {
      const filteredComments = response.repository.pullRequest.comments.nodes.filter((node) => assigneeLogins.includes(node.author.login));
      additionalComments.push(...filteredComments);
      hasNextPage = response.repository.pullRequest.comments.pageInfo.hasNextPage;
      cursor = response.repository.pullRequest.comments.pageInfo.endCursor;
    } else {
      hasNextPage = false;
    }
  }

  return { comments: additionalComments };
}

function calculateTimeWithBuffers(events: TimeEvent[]): { totalMinutes: number; formattedTime: string } {
  if (events.length === 0) {
    return { totalMinutes: 0, formattedTime: "0 minutes" };
  }

  events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const timeRanges = events.map((event) => {
    const bufferMinutes = TIME_BUFFERS[event.type];
    const start = new Date(event.timestamp);
    const end = new Date(event.timestamp);
    start.setMinutes(start.getMinutes() - bufferMinutes);
    end.setMinutes(end.getMinutes() + bufferMinutes);
    return { start, end };
  });

  const mergedRanges = mergeTimeRanges(timeRanges);
  const totalMinutes = calculateTotalMinutes(mergedRanges);
  return formatTime(totalMinutes);
}

function mergeTimeRanges(ranges: Array<{ start: Date; end: Date }>): Array<{ start: Date; end: Date }> {
  const mergedRanges: Array<{ start: Date; end: Date }> = [];

  for (const range of ranges) {
    if (mergedRanges.length === 0) {
      mergedRanges.push(range);
      continue;
    }

    const lastRange = mergedRanges[mergedRanges.length - 1];
    if (range.start <= lastRange.end) {
      lastRange.end = new Date(Math.max(lastRange.end.getTime(), range.end.getTime()));
    } else {
      mergedRanges.push(range);
    }
  }

  return mergedRanges;
}

function calculateTotalMinutes(ranges: Array<{ start: Date; end: Date }>): number {
  return ranges.reduce((total, range) => {
    const durationMinutes = (range.end.getTime() - range.start.getTime()) / (1000 * 60);
    return total + durationMinutes;
  }, 0);
}

function formatTime(totalMinutes: number): { totalMinutes: number; formattedTime: string } {
  const units = [
    { value: 60, unit: "minute" },
    { value: 24, unit: "hour" },
    { value: 7, unit: "day" },
    { value: 4, unit: "week" },
    { value: Infinity, unit: "month" },
  ];

  let time = Math.round(totalMinutes);
  let unitIndex = 0;

  while (unitIndex < units.length - 1 && time >= units[unitIndex].value) {
    time = Math.round(time / units[unitIndex].value);
    unitIndex++;
  }

  const unit = units[unitIndex].unit;
  const formattedTime = `${time} ${time === 1 ? unit : unit + "s"}`;

  return { totalMinutes, formattedTime };
}

async function calculateTimeToComplete(
  issue: IssueWithComments,
  owner: string,
  repo: string,
  prData: PullRequestWithLinkedIssues
): Promise<string | undefined> {
  if (!issue.closed_at) return "Not completed";

  try {
    const events: TimeEvent[] = [];
    if (issue.user === null) return;

    const contributors = new Set(prData.assignees.map((a: { login: string }) => a.login));
    logger.info(`Commits: ${prData.commits.length}, Comments: ${prData.comments.length}`);

    events.push(...getCommitEvents(prData.commits, contributors));
    events.push(...getCommentEvents(prData.comments, contributors));
    events.push(...getIssueCommentEvents(issue.issueComments, contributors));

    const { formattedTime } = calculateTimeWithBuffers(events);
    return formattedTime;
  } catch (error) {
    if (!(error instanceof Error)) {
      throw new Error("An unknown error occurred");
    }
    return calculateFallbackTime(issue);
  }
}

function getCommitEvents(commits: CommitNode[], contributors: Set<string>): TimeEvent[] {
  return commits
    .filter((node) => {
      const authorLogin = node.commit.author.user?.login;
      return authorLogin && contributors.has(authorLogin);
    })
    .map((node) => ({
      type: "COMMIT" as const,
      timestamp: new Date(node.commit.committedDate),
    }));
}

function getCommentEvents(comments: CommentNode[], contributors: Set<string>): TimeEvent[] {
  return comments
    .filter((node) => contributors.has(node.author.login))
    .map((node) => ({
      type: "COMMENT" as const,
      timestamp: new Date(node.createdAt),
    }));
}

function getIssueCommentEvents(comments: IssueWithComments["issueComments"], contributors: Set<string>): TimeEvent[] {
  if (!comments) return [];

  const validComments = [];

  for (const comment of comments) {
    if (!contributors.has(comment.user.login)) continue;
    validComments.push(comment);
  }

  return validComments.map((comment) => ({
    type: "COMMENT" as const,
    timestamp: new Date(comment.created_at),
  }));
}

function calculateFallbackTime(issue: IssueWithComments): string {
  if (!issue.closed_at) {
    return "Unknown time (not closed)";
  }
  const diffMs = new Date(issue.closed_at).getTime() - new Date(issue.created_at).getTime();
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const { formattedTime } = formatTime(diffMinutes);
  return `${formattedTime} (calculation error)`;
}

function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const randomBytes = crypto.randomBytes(4);
    const j = Math.floor((randomBytes.readUInt32BE(0) / 0x100000000) * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

function formatContent(issue: Issue, metadata: string): string {
  return [
    "### Issue Title",
    issue.title || "No Title",
    "",
    "### Issue Description",
    `\n${issue.body}`,
    "",
    "### Actual Time Taken to Complete the Task",
    metadata,
  ].join("\n");
}

function balanceDataset(examples: TrainingExample[]): TrainingExample[] {
  const groupedExamples = new Map<string, TrainingExample[]>();
  for (const example of examples) {
    const currentGroup = groupedExamples.get(example.timeLabel) || [];
    currentGroup.push(example);
    groupedExamples.set(example.timeLabel, currentGroup);
  }

  let minCount = Infinity;
  for (const group of groupedExamples.values()) {
    minCount = Math.min(minCount, group.length);
  }

  const balancedExamples: TrainingExample[] = [];
  for (const group of groupedExamples.values()) {
    const shuffled = shuffleArray(group);
    const selected = shuffled.slice(0, minCount);
    balancedExamples.push(...selected);
  }
  return shuffleArray(balancedExamples);
}

async function processRepository(owner: string, repo: string, sourceStats: Map<string, number>): Promise<TrainingExample[]> {
  const examples: TrainingExample[] = [];
  const prs = await fetchMergedPullRequests(owner, repo);
  const repoPath = `${owner}/${repo}`;
  logger.info(`\nFetched ${prs.length} PRs from ${repoPath}`);

  let validIssueCount = 0;

  for (const pr of prs) {
    const issueExamples = await processIssuesForPullRequest(owner, repo, pr, repoPath, sourceStats);
    examples.push(...issueExamples);
    validIssueCount += issueExamples.length;
  }

  logger.info(`Found ${validIssueCount} valid issues with time labels in ${repoPath}`);
  return examples;
}

async function processIssuesForPullRequest(
  owner: string,
  repo: string,
  pr: PullRequest,
  repoPath: string,
  sourceStats: Map<string, number>
): Promise<TrainingExample[]> {
  const examples: TrainingExample[] = [];
  const { assignees } = await getAssignees(owner, repo, pr.number);
  const prData = await getPullRequestDetailsAndLinkedIssues(
    owner,
    repo,
    pr.number.toString(),
    assignees.map((a) => a.login)
  );

  for (const issue of prData.linkedIssues) {
    const example = await processIssue(issue, owner, repo, prData, repoPath, sourceStats);
    if (example) {
      examples.push(example);
    }
  }

  return examples;
}

async function processIssue(
  issue: IssueWithComments,
  owner: string,
  repo: string,
  prData: PullRequestWithLinkedIssues,
  repoPath: string,
  sourceStats: Map<string, number>
): Promise<TrainingExample | null> {
  const timeLabels = issue.labels.map((label) => label.name).filter((name) => name.startsWith("Time: "));

  if (timeLabels.length === 0) return null;

  const completionTime = await calculateTimeToComplete(issue, owner, repo, prData);
  logger.info(`Issue #${issue.number} in ${repoPath} took ${completionTime} to complete`);

  if (completionTime === "Not completed" || completionTime === undefined) return null;

  const timeLabel = timeLabels[0];
  if (timeLabel === undefined) return null;

  sourceStats.set(repoPath, (sourceStats.get(repoPath) || 0) + 1);

  return createTrainingExample(issue, completionTime, timeLabel, repoPath);
}

function createTrainingExample(issue: Issue, completionTime: string, timeLabel: string, repoPath: string): TrainingExample {
  const timeString = `Time to Complete: ${completionTime}`;

  const systemPrompt = [
    "Given the issue content and actual completion time, assign the most appropriate Time Label.",
    "Consider the task complexity and actual completion time.",
    "Ensure your selection reflects the real time investment needed for the task.",
  ].join("\n");

  const content = formatContent(issue, timeString);

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content },
    { role: "assistant", content: timeLabel },
  ];

  return { messages, timeLabel, source: repoPath };
}

function prepareDatasetSplit(allExamples: TrainingExample[]): { trainData: string; validationData: string } {
  const balancedExamples = balanceDataset(allExamples);
  const trainSize = Math.floor(balancedExamples.length * TRAIN_SPLIT);
  const trainData = balancedExamples.slice(0, trainSize);
  const validationData = balancedExamples.slice(trainSize);

  logger.info("\nDataset split:");
  logger.info(`Training set: ${trainData.length} examples`);
  logger.info(`Validation set: ${validationData.length} examples`);

  const trainJsonlData = trainData.map((data) => JSON.stringify({ messages: data.messages })).join("\n");
  const validationJsonlData = validationData.map((data) => JSON.stringify({ messages: data.messages })).join("\n");

  return {
    trainData: trainJsonlData,
    validationData: validationJsonlData,
  };
}

function displaySourceStats(sourceStats: Map<string, number>): void {
  logger.info("\nSources breakdown:");
  for (const [source, count] of sourceStats.entries()) {
    logger.info(`${source}: ${count} examples`);
  }
}

let gitChanges: Array<{ path: string; content: string }> = [];
const MAX_PAYLOAD_SIZE = 100000000;

async function gitCommit(data: string, fileName: string) {
  try {
    gitChanges.push({
      path: fileName,
      content: data,
    });
  } catch (error) {
    console.error(`Error handling data for ${fileName}:`, error);
    throw error;
  }
}

async function gitPush() {
  if (gitChanges.length === 0) {
    logger.info("No changes to commit");
    return;
  }

  try {
    const owner = process.env.REPO_OWNER;
    const repo = process.env.REPO_NAME;

    if (!owner || !repo) {
      throw new Error("Repository owner or name not found in environment variables");
    }
    const branch = "__STORAGE__";

    let isBranchPresent = true;
    try {
      await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });
    } catch {
      isBranchPresent = false;
    }
    let latestCommitSha: string;

    if (!isBranchPresent) {
      const { data: emptyTree } = await octokit.rest.git.createTree({
        owner,
        repo,
        tree: [],
      });

      const { data: commit } = await octokit.rest.git.createCommit({
        owner,
        repo,
        message: "Initialize __STORAGE__ branch",
        tree: emptyTree.sha,
        parents: [],
      });

      // Create the branch
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: commit.sha,
      });

      latestCommitSha = commit.sha;
    } else {
      const { data: refData } = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });
      latestCommitSha = refData.object.sha;
    }

    // Process changes in batches
    let currentChanges: Array<{ path: string; content: string }> = [];
    let currentSize = 0;

    for (const change of gitChanges) {
      const changeSize = Buffer.byteLength(change.content, "utf8");
      if (currentSize + changeSize > MAX_PAYLOAD_SIZE) {
        await commitBatch(octokit, owner, repo, branch, latestCommitSha, currentChanges);
        currentChanges = [];
        currentSize = 0;
      }
      currentChanges.push(change);
      currentSize += changeSize;
    }

    if (currentChanges.length > 0) {
      await commitBatch(octokit, owner, repo, branch, latestCommitSha, currentChanges);
    }

    gitChanges = [];
    logger.info("Successfully pushed changes to __STORAGE__ branch");
  } catch (error) {
    console.error("Error pushing changes:", error);
    throw error;
  }
}

async function commitBatch(octokit: Octokit, owner: string, repo: string, branch: string, baseSha: string, changes: Array<{ path: string; content: string }>) {
  if (changes.length === 0) return;

  const { data: treeData } = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: baseSha,
    tree: changes.map((change) => ({
      path: change.path,
      mode: "100644",
      type: "blob",
      content: change.content,
    })),
  });

  const { data: commitData } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: "Update training data",
    tree: treeData.sha,
    parents: [baseSha],
  });

  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commitData.sha,
  });

  logger.info(`Committed to ${branch}: ${commitData.sha}`);
}

async function getCompletedIssues(): Promise<void> {
  try {
    if (!process.env.GITHUB_TOKEN) {
      throw new Error("GitHub token not found");
    }

    logger.info("Starting data collection...");
    const allExamples: TrainingExample[] = [];
    const sourceStats = new Map<string, number>();

    for (const config of repositories) {
      for (const repo of config.repos) {
        const examples = await processRepository(config.owner, repo, sourceStats);
        allExamples.push(...examples);
      }
    }

    if (allExamples.length === 0) {
      throw new Error("No valid training data found - no issues had valid time labels");
    }
    displaySourceStats(sourceStats);
    const { trainData, validationData } = prepareDatasetSplit(allExamples);

    // Commit the files
    await gitCommit(trainData, "data/fine_tuning_train.jsonl");
    await gitCommit(validationData, "data/fine_tuning_validation.jsonl");

    // Push all changes
    await gitPush();

    logger.info("\nData files committed to __STORAGE__ branch");
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("An unknown error occurred");
  }
}

if (import.meta.url === import.meta.resolve("./scraper.ts")) {
  getCompletedIssues()
    .then(() => {
      logger.info("\nScraping completed successfully");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "An unknown error occurred");
      process.exit(1);
    });
}
