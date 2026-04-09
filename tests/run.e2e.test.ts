import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Context } from "../src/types/context";

const mockCallLlm = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockSanitizeLlmResponse = jest.fn<(input: string) => string>((input: string) => input);

jest.mock("@ubiquity-os/plugin-sdk", () => ({
  callLlm: mockCallLlm,
  sanitizeLlmResponse: mockSanitizeLlmResponse,
}));

const mockAddLabelToIssue = jest.fn();
const mockRemoveLabelFromIssue = jest.fn();
const mockCreateLabel = jest.fn();

jest.mock("../src/shared/label", () => ({
  addLabelToIssue: mockAddLabelToIssue,
  removeLabelFromIssue: mockRemoveLabelFromIssue,
  createLabel: mockCreateLabel,
}));

const mockDispatchDeepEstimate = jest.fn();
jest.mock("../src/utils/deep-estimate-dispatch", () => ({
  dispatchDeepEstimate: mockDispatchDeepEstimate,
}));

const mockSyncPriceLabelsToConfig = jest.fn();
jest.mock("../src/handlers/sync-labels-to-config", () => ({
  syncPriceLabelsToConfig: mockSyncPriceLabelsToConfig,
}));

const mockOnIssueOpenedUpdatePricing = jest.fn();
jest.mock("../src/handlers/pricing-label", () => ({
  onIssueOpenedUpdatePricing: mockOnIssueOpenedUpdatePricing,
}));

const logger = {
  ok: jest.fn(),
  warn: jest.fn((message: string) => new Error(message)),
  info: jest.fn(),
  error: jest.fn((message: string) => new Error(message)),
  debug: jest.fn(),
};

let run: typeof import("../src/run").run;

function makeOctokit() {
  return {
    rest: {
      issues: {
        addLabels: jest.fn(),
        removeLabel: jest.fn(),
        createLabel: jest.fn(),
        listLabelsForRepo: jest.fn(),
        listComments: jest.fn(),
      },
    },
    paginate: jest.fn(() => Promise.resolve([{ name: "Time: 2 Hours" }])),
  };
}

function baseContext() {
  return {
    logger,
    authToken: "token",
    env: {},
    config: {
      llmModel: {
        reasoningEffort: "low",
      },
      labels: {
        priority: [{ name: "Priority: 1 (Normal)" }],
      },
      basePriceMultiplier: 1,
      shouldFundContributorClosedIssue: false,
    },
  };
}

function makeIssueOpenedContext(): Context<"issues.opened"> {
  return {
    ...baseContext(),
    eventName: "issues.opened",
    payload: {
      action: "opened",
      repository: {
        owner: { login: "owner" },
        name: "repo",
        html_url: "https://github.com/owner/repo",
      },
      sender: { login: "author" },
      issue: {
        number: 1,
        title: "Speed up caching",
        body: "Cache API responses in memory.",
        labels: [],
        comments: 0,
      },
    },
    octokit: makeOctokit(),
  } as unknown as Context<"issues.opened">;
}

function makeTimeCommandContext(): Context<"issue_comment.created"> {
  return {
    ...baseContext(),
    eventName: "issue_comment.created",
    command: {
      name: "time",
      parameters: {},
    },
    payload: {
      action: "created",
      repository: {
        owner: { login: "owner" },
        name: "repo",
        html_url: "https://github.com/owner/repo",
      },
      sender: { login: "author" },
      issue: {
        number: 2,
        title: "Add telemetry",
        body: "Record metrics for worker execution.",
        user: { login: "author" },
        labels: [],
        comments: 0,
      },
      comment: {
        id: 1,
        body: "/time",
        user: { login: "author", type: "User" },
      },
    },
    octokit: makeOctokit(),
  } as unknown as Context<"issue_comment.created">;
}

describe("run e2e time estimation", () => {
  const envSnapshot = process.env.GITHUB_ACTIONS;

  beforeAll(async () => {
    ({ run } = await import("../src/run"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (envSnapshot === undefined) {
      delete process.env.GITHUB_ACTIONS;
    } else {
      process.env.GITHUB_ACTIONS = envSnapshot;
    }
  });

  it("handles issues.opened with auto-estimated time label", async () => {
    process.env.GITHUB_ACTIONS = "true";
    mockCallLlm.mockResolvedValue({
      choices: [{ message: { content: "2 hours" } }],
    });

    const context = makeIssueOpenedContext();
    await expect(run(context)).resolves.toEqual({ message: "OK" });
    expect(mockCallLlm).toHaveBeenCalled();
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(context, "Time: 2 Hours");
    expect(mockDispatchDeepEstimate).toHaveBeenCalled();
  });

  it("propagates errors when /time auto-estimation fails", async () => {
    mockCallLlm.mockRejectedValue(new Error("LLM API error: 401 - unauthorized"));

    const context = makeTimeCommandContext();
    await expect(run(context)).rejects.toThrow("Failed to estimate time with LLM. Provide a duration like `/time 2 hours`.");
    expect(mockDispatchDeepEstimate).not.toHaveBeenCalled();
    expect(mockAddLabelToIssue).not.toHaveBeenCalled();
  });
});
