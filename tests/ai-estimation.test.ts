import { jest } from "@jest/globals";
import { Context } from "../src/types/context";
import { setupTests } from "./__mocks__/helpers";
import { db } from "./__mocks__/db";
import { drop } from "@mswjs/data";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import * as autoEstimationModuleFunctions from "../src/handlers/get-priority-time";
import * as issueModuleFunctions from "../src/shared/issue";

const ISSUE_ID = 2; // Mock issue ID for testing

function createMockOctokit(overrides: object = {}, paginateMock = jest.fn().mockImplementation(() => Promise.resolve([]))) {
  return {
    rest: {
      issues: {
        updateLabel: jest.fn(),
        addLabels: jest.fn(),
        createLabel: jest.fn(),
        removeLabel: jest.fn(),
        ...overrides,
      },
      repos: {
        getCollaboratorPermissionLevel: jest.fn(),
        ...(overrides as { repos?: object }).repos,
      },
    },
    paginate: paginateMock,
  };
}

function createMockContext(overrides: Partial<Context> = {}): Context {
  const issue = db.issue.findFirst({ where: { id: { equals: 2 } } });
  if (!issue) throw new Error("Mock issue not found");

  const baseConfig = {
    labels: {
      time: [{ name: "Time: <1 Hour" }],
      priority: [{ name: "Priority: 1 (Normal)" }],
    },
    basePriceMultiplier: 1,
    globalConfigUpdate: { excludeRepos: [] },
    autoLabeling: { enabled: false },
  };

  // Deep merge to handle nested properties like 'labels' and 'autoLabeling'
  const config = {
    ...baseConfig,
    ...(overrides.config as object),
    labels: {
      ...baseConfig.labels,
      ...((overrides.config as { labels?: object })?.labels ?? {}),
    },
    autoLabeling: {
      ...baseConfig.autoLabeling,
      ...((overrides.config as { autoLabeling?: object })?.autoLabeling ?? {}),
    },
  };

  return {
    config,
    logger: new Logs("info"),
    payload: {
      repository: { owner: { login: "owner" }, name: "repo" },
      issue,
      ...(overrides.payload as object),
    },
    octokit: createMockOctokit((overrides.octokit as object) ?? {}),
    env: {
      BASETEN_API_KEY: "fake-key",
      BASETEN_API_URL: "https://fake-url.com",
    },
    ...overrides,
  } as unknown as Context;
}

function mockGetPriorityTime(mockEstimate: { time: string; priority: string }) {
  const issue = db.issue.findFirst({ where: { id: { equals: ISSUE_ID } } });
  if (!issue) throw new Error("Mock issue not found");
  jest.unstable_mockModule("../src/handlers/get-priority-time", () => ({
    ...autoEstimationModuleFunctions,
    getPriorityTime: jest.fn((issueDescription: string, issueTitle: string, basetenApiKey: string, basetenApiUrl: string) => {
      expect(issueDescription).toBe(issue.body);
      expect(issueTitle).toBe(issue.title);
      expect(basetenApiKey).toBe("fake-key");
      expect(basetenApiUrl).toBe("https://fake-url.com");
      return Promise.resolve(mockEstimate);
    }),
  }));
}

describe("AI Estimation Tests", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();
    drop(db);
    process.env.NODE_ENV = "local"; // to bypass isGithubOrLocalEnvironment
    await setupTests();
  });

  it("Case 1: Should create labels on issue creation when auto-labeling is enabled in full mode", async () => {
    const mockEstimate = { time: "2", priority: "Priority: 2 (Medium)" };
    mockGetPriorityTime(mockEstimate);
    db.issue.update({ where: { id: { equals: 2 } }, data: { labels: [] } });

    const { autoPricingHandler } = await import("../src/handlers/auto-pricing");
    const context = createMockContext({
      eventName: "issues.opened",
      config: {
        autoLabeling: { enabled: true, mode: "full" },
        basePriceMultiplier: 1,
        labels: { time: [], priority: [] },
      },
    } as unknown as Partial<Context>);

    await autoPricingHandler(context);

    const owner = "owner";
    const repo = "repo";
    const issueNumber = 2;

    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner,
      repo,
      issue_number: issueNumber,
      labels: [`Time: ${mockEstimate.time} hours`],
    });
    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner,
      repo,
      issue_number: issueNumber,
      labels: [mockEstimate.priority],
    });
    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner,
      repo,
      issue_number: issueNumber,
      labels: ["Price: 50 USD"],
    });
    expect(context.octokit.rest.issues.createLabel).toHaveBeenCalledTimes(2);
    expect(context.octokit.rest.issues.removeLabel).not.toHaveBeenCalled();
  });

  it("Case 2: Should not create AI labels when auto-labeling is disabled", async () => {
    db.issue.update({ where: { id: { equals: ISSUE_ID } }, data: { labels: [] } });
    const context = createMockContext({
      eventName: "issues.opened",
      config: {
        autoLabeling: { enabled: false },
        labels: { time: [], priority: [] },
      },
    } as unknown as Partial<Context>);
    const { run } = await import("../src/run");

    await run(context);

    const labels = db.issue.findFirst({ where: { id: { equals: ISSUE_ID } } })?.labels;
    expect(labels).toHaveLength(0);
    expect(context.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(context.octokit.rest.issues.createLabel).not.toHaveBeenCalled();
    expect(context.octokit.rest.issues.removeLabel).not.toHaveBeenCalled();
  });

  it("Case 3: Should create AI labels when enabled with a trigger label", async () => {
    const mockEstimate = { time: "10", priority: "Priority: 5 (Emergency)" };
    mockGetPriorityTime(mockEstimate);
    db.issue.update({ where: { id: { equals: ISSUE_ID } }, data: { labels: [] } });

    const context = createMockContext({
      eventName: "issues.opened",
      config: {
        basePriceMultiplier: 1,
        autoLabeling: { enabled: true, triggerLabel: "auto_price_label" },
        labels: { time: [], priority: [] },
      },
    } as unknown as Partial<Context>);
    const { run } = await import("../src/run");

    await run(context);

    const price = autoEstimationModuleFunctions.getPricing(context.config.basePriceMultiplier, parseFloat(mockEstimate.time), mockEstimate.priority);

    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({ labels: [`Time: ${mockEstimate.time} hours`] }));
    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({ labels: [mockEstimate.priority] }));
    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({ labels: [context.config.autoLabeling.triggerLabel] }));
    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({ labels: [`Price: ${price} USD`] }));
    expect(context.octokit.rest.issues.createLabel).toHaveBeenCalledTimes(3);
    expect(context.octokit.rest.issues.removeLabel).not.toHaveBeenCalled();
  });

  it("Case 4: Should create labels on 'issues.labeled' event with trigger label", async () => {
    const mockEstimate = { time: "192", priority: "Priority: 1 (Normal)" };
    mockGetPriorityTime(mockEstimate);

    jest.unstable_mockModule("../src/shared/issue", () => ({
      ...issueModuleFunctions,
      isUserAdminOrBillingManager: jest.fn().mockImplementation(() => Promise.resolve({ data: { permission: "admin" } })),
    }));

    db.issue.update({
      where: { id: { equals: ISSUE_ID } },
      data: { labels: [{ id: 1, name: "auto_price_label" }] },
    });

    const updatedIssue = db.issue.findFirst({ where: { id: { equals: ISSUE_ID } } });

    const context = createMockContext({
      eventName: "issues.labeled",
      config: {
        autoLabeling: { enabled: true, mode: "full", triggerLabel: "auto_price_label" },
        labels: {
          priority: [{ name: "Priority: 1 (Normal)" }, { name: "Priority: 2 (Medium)" }],
          time: [{ name: "Time: <1 day" }, { name: "Time: <1 Week" }],
        },
        basePriceMultiplier: 1,
      },
      payload: {
        issue: updatedIssue,
        label: { name: "auto_price_label" },
        sender: { login: "ubiquity-os" },
        repository: { owner: { login: "ubiquity-os" }, name: "daemon-pricing" },
        action: "labeled",
      },
      CommentHandler: { postComment: jest.fn() },
    } as unknown as Partial<Context>);

    const { run } = await import("../src/run");
    await run(context);

    const timeLabel = autoEstimationModuleFunctions.convertHoursLabel(mockEstimate.time);
    const priceLabel = `Price: ${autoEstimationModuleFunctions.getPricing(
      context.config.basePriceMultiplier,
      parseFloat(mockEstimate.time),
      mockEstimate.priority
    )} USD`;
    const owner = "ubiquity-os";
    const repo = "daemon-pricing";
    const issueNumber = 2;

    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith({ owner, repo, issue_number: issueNumber, labels: [timeLabel] });
    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith({ owner, repo, issue_number: issueNumber, labels: [mockEstimate.priority] });
    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith({ owner, repo, issue_number: issueNumber, labels: [priceLabel] });
    expect(context.octokit.rest.issues.createLabel).toHaveBeenCalledWith({ owner, repo, name: timeLabel, color: "ededed", description: undefined });
    expect(context.octokit.rest.issues.createLabel).toHaveBeenCalledWith({ owner, repo, name: priceLabel, color: "1f883d", description: undefined });
    expect(context.octokit.rest.issues.removeLabel).not.toHaveBeenCalled();
  });
});
