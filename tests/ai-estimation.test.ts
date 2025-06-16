import { jest } from "@jest/globals";
import { Context } from "../src/types/context";
import { setupTests } from "./__mocks__/helpers";
import { db } from "./__mocks__/db";
import { drop } from "@mswjs/data";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import * as allFunctions from "../src/handlers/get-priority-time";
import * as issueModuleFunctions from "../src/shared/issue";

function createMockOctokit(overrides = {}) {
  return {
    rest: {
      issues: {
        updateLabel: jest.fn(),
        addLabels: jest.fn(),
        ...overrides,
      },
    },
    paginate: jest.fn(),
  };
}

function createMockContext(overrides = {}) {
  return {
    config: {
      labels: { time: [], priority: [] },
      basePriceMultiplier: 1,
      globalConfigUpdate: { excludeRepos: [] },
    },
    logger: new Logs("info"),
    payload: {
      repository: { owner: { login: "owner" }, name: "repo" },
    },
    octokit: createMockOctokit(),
    ...overrides,
  } as unknown as Context;
}

describe("AI Estimation Tests", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();
    drop(db);
    await setupTests();
  });

  it("Case 1: Create label on issue creation", async () => {
    const mockEstimate = { time: "2", priority: "Priority: 2 (Medium)" };
    const ISSUE_ID = 2;
    // reset the labels in the db for the issue
    db.issue.update({
      where: { id: { equals: ISSUE_ID } },
      data: {
        labels: [],
      },
    });
    const issue = db.issue.findFirst({ where: { id: { equals: ISSUE_ID } } });
    if (!issue) {
      throw new Error("Repository or issue not found in the mock database");
    }
    jest.unstable_mockModule("../src/handlers/get-priority-time", () => ({
      ...allFunctions,
      getPriorityTime: jest.fn((issueDescription: string, issueTitle: string, basetenApiKey: string, basetenApiUrl: string) => {
        expect(issueDescription).toBe(issue.body);
        expect(issueTitle).toBe(issue.title);
        expect(basetenApiKey).toBe("fake-key");
        expect(basetenApiUrl).toBe("https://fake-url.com");
        return Promise.resolve(mockEstimate);
      }),
    }));
    const { autoPricingHandler } = await import("../src/handlers/auto-pricing");

    const context = createMockContext({
      eventName: "issues.opened",
      env: {
        BASETEN_API_KEY: "fake-key",
        BASETEN_API_URL: "https://fake-url.com",
      },
      config: {
        labels: { time: [], priority: [] },
        basePriceMultiplier: 1,
        globalConfigUpdate: { excludeRepos: [] },
        autoLabeling: {
          enabled: true,
          mode: "full",
        },
      },
      payload: {
        repository: {
          owner: { login: "owner" },
          name: "repo",
        },
        issue,
      },
      octokit: createMockOctokit({
        createLabel: jest.fn(),
        addLabels: jest.fn(),
        removeLabel: jest.fn(),
      }),
    });

    // Act
    await autoPricingHandler(context as unknown as Context);

    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: ISSUE_ID,
      labels: [`Time: ${mockEstimate.time} hours`],
    });

    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: ISSUE_ID,
      labels: [mockEstimate.priority],
    });

    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: ISSUE_ID,
      labels: ["Price: 50 USD"],
    });

    expect(context.octokit.rest.issues.createLabel).toHaveBeenCalledTimes(2);
    expect(context.octokit.rest.issues.removeLabel).not.toHaveBeenCalled();
    expect(context.octokit.rest.issues.updateLabel).not.toHaveBeenCalled();
  }, 50000);

  it("Case 2: No AI label creation (disabled from config)", async () => {
    const ISSUE_ID = 2;

    db.issue.update({
      where: { id: { equals: ISSUE_ID } },
      data: {
        labels: [],
      },
    });
    const issue = db.issue.findFirst({ where: { id: { equals: ISSUE_ID } } });
    console.log("Issue before test:", issue);
    if (!issue) {
      throw new Error("Repository or issue not found in the mock database");
    }

    const { run } = await import("../src/run");

    const context = createMockContext({
      eventName: "issues.opened",
      env: {
        BASETEN_API_KEY: "fake-key",
        BASETEN_API_URL: "https://fake-url.com",
      },
      config: {
        labels: { time: [], priority: [] },
        basePriceMultiplier: 1,
        globalConfigUpdate: { excludeRepos: [] },
        autoLabeling: {
          enabled: false, // Disable auto-labeling
        },
      },
      payload: {
        repository: {
          owner: { login: "owner" },
          name: "repo",
        },
        issue,
      },
      octokit: createMockOctokit({
        createLabel: jest.fn(),
        addLabels: jest.fn(),
        removeLabel: jest.fn(),
      }),
    });

    // Act
    await run(context as unknown as Context);

    // db
    const labels = db.issue.findFirst({ where: { id: { equals: ISSUE_ID } } })?.labels;
    expect(labels).toBeDefined();
    expect(labels).toHaveLength(0);
    expect(context.octokit.rest.issues.addLabels).not.toHaveBeenCalled();
    expect(context.octokit.rest.issues.createLabel).not.toHaveBeenCalled();
    expect(context.octokit.rest.issues.removeLabel).not.toHaveBeenCalled();
  }, 50000);
  // Case 3: Create (Priority/Time/Price) Label (on issue.labeled event with trigger label)
  it("Create (Priority/Time/Price) Label (on issue.labeled event with trigger label)", async () => {
    const isUserAdminOrBillingManagerMock = jest.fn();
    isUserAdminOrBillingManagerMock.mockImplementation(() => Promise.resolve({ data: { permission: "admin" } }));
    jest.unstable_mockModule("../src/shared/issue", () => ({
      ...issueModuleFunctions,
      isUserAdminOrBillingManager: isUserAdminOrBillingManagerMock,
    }));
    const ISSUE_ID = 2;
    // reset the labels in the db for the issue
    db.issue.update({
      where: { id: { equals: ISSUE_ID } },
      data: {
        labels: [
          {
            id: 1,
            name: "auto_price_label",
          },
        ],
      },
    });
    const issue = db.issue.findFirst({ where: { id: { equals: ISSUE_ID } } });
    if (!issue) {
      throw new Error("Repository or issue not found in the mock database");
    }
    const priceEstimate = {
      time: "192",
      priority: "Priority: 1 (Normal)",
    };
    jest.unstable_mockModule("../src/handlers/get-priority-time", () => ({
      ...allFunctions,
      getPriorityTime: jest.fn((issueDescription: string, issueTitle: string, basetenApiKey: string, basetenApiUrl: string) => {
        expect(issueDescription).toBe(issue.body);
        expect(issueTitle).toBe(issue.title);
        expect(basetenApiKey).toBe("fake-key");
        expect(basetenApiUrl).toBe("https://fake-url.com");
        return Promise.resolve(priceEstimate);
      }),
    }));
    const { run } = await import("../src/run");

    const context = createMockContext({
      eventName: "issues.labeled",
      env: {
        BASETEN_API_KEY: "fake-key",
        BASETEN_API_URL: "https://fake-url.com",
      },
      config: {
        labels: {
          priority: [{ name: "Priority: 1 (Normal)" }, { name: "Priority: 2 (Medium)" }],
          time: [{ name: "Time: <1 day" }, { name: "Time: <1 Week" }],
        },
        basePriceMultiplier: 1,
        globalConfigUpdate: { excludeRepos: [] },
        autoLabeling: {
          enabled: true,
          mode: "full",
          triggerLabel: "auto_price_label",
        },
      },
      payload: {
        label: {
          name: "auto_price_label",
        },
        sender: {
          login: "ubiquity-os",
        },
        repository: {
          name: "daemon-pricing",
          full_name: "ubiquity-os-marketplace/daemon-pricing",
          owner: {
            login: "ubiquity-os",
          },
        },
        action: "labeled",
        organization: {
          login: "ubiquity-os-marketplace",
        },
        issue,
      },
      octokit: createMockOctokit({
        createLabel: jest.fn(),
        addLabels: jest.fn(),
        removeLabel: jest.fn(),
        repos: {
          getCollaboratorPermissionLevel: isUserAdminOrBillingManagerMock,
        },
      }),
      CommentHandler: {
        postComment: jest.fn(),
      },
    });

    await run(context as unknown as Context);

    const price = `Price: ${allFunctions.getPricing(context.config.basePriceMultiplier, parseFloat(priceEstimate.time), priceEstimate.priority)} USD`;

    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "ubiquity-os",
      repo: "daemon-pricing",
      issue_number: ISSUE_ID,
      labels: [allFunctions.convertHoursLabel(priceEstimate.time)],
    });
    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "ubiquity-os",
      repo: "daemon-pricing",
      issue_number: ISSUE_ID,
      labels: [priceEstimate.priority],
    });
    expect(context.octokit.rest.issues.addLabels).toHaveBeenCalledWith({
      owner: "ubiquity-os",
      repo: "daemon-pricing",
      issue_number: ISSUE_ID,
      labels: [price],
    });

    expect(context.octokit.rest.issues.createLabel).toHaveBeenCalledWith({
      owner: "ubiquity-os",
      repo: "daemon-pricing",
      name: allFunctions.convertHoursLabel(priceEstimate.time),
      color: "ededed",
      description: undefined,
    });

    expect(context.octokit.rest.issues.createLabel).toHaveBeenCalledWith({
      owner: "ubiquity-os",
      repo: "daemon-pricing",
      name: price,
      color: "1f883d",
      description: undefined,
    });

    expect(context.octokit.rest.issues.removeLabel).not.toHaveBeenCalled();
  }, 10000);
});
