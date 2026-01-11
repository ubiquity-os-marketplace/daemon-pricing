import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { drop } from "@mswjs/data";
import { customOctokit as Octokit } from "@ubiquity-os/plugin-sdk/octokit";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import dotenv from "dotenv";
import { ZERO_SHA } from "../src/handlers/check-modified-base-rate";
import { globalLabelUpdate } from "../src/handlers/global-config-update";
import { Context } from "../src/types/context";
import { Label } from "../src/types/github";
import { priceMap, PRIORITY_LABELS } from "./__mocks__/constants";
import { db } from "./__mocks__/db";
import { createCommit, inMemoryCommits, setupTests } from "./__mocks__/helpers";
import { server } from "./__mocks__/node";
import { STRINGS } from "./__mocks__/strings";

dotenv.config();

const TEST_TIMEOUT = 30 * 1000;

type CreateCommitParams = {
  owner: string;
  repo: string;
  sha: string;
  modified: string[];
  added: string[];
  withBaseRateChanges: boolean;
  withPlugin: boolean;
  amount: number;
};

beforeAll(() => {
  server.listen();
});
afterEach(() => {
  server.resetHandlers();
  jest.restoreAllMocks();
});
afterAll(() => server.close());

describe("Label Base Rate Changes", () => {
  beforeEach(async () => {
    drop(db);
    await setupTests();
  });

  it(
    "Should change the base rate of all price labels",
    async () => {
      const commits = inMemoryCommits(STRINGS.SHA_1);
      const { context } = innerSetup(1, commits, STRINGS.SHA_1, STRINGS.SHA_1, {
        owner: STRINGS.UBIQUITY,
        repo: STRINGS.TEST_REPO,
        sha: STRINGS.SHA_1,
        modified: [STRINGS.CONFIG_PATH],
        added: [],
        withBaseRateChanges: true,
        withPlugin: false,
        amount: 5,
      });

      await globalLabelUpdate(context);

      const updatedRepo = db.repo.findFirst({ where: { id: { equals: 1 } } });
      const updatedIssue = db.issue.findFirst({ where: { id: { equals: 1 } } });
      const updatedIssue2 = db.issue.findFirst({ where: { id: { equals: 3 } } });

      expect(updatedRepo?.labels).toHaveLength(29);
      expect(updatedIssue?.labels).toHaveLength(3);
      expect(updatedIssue2?.labels).toHaveLength(2);

      const priceLabels = updatedIssue?.labels.filter((label) => (label as Label).name.includes("Price:"));
      const priceLabels2 = updatedIssue2?.labels.filter((label) => (label as Label).name.includes("Price:"));

      expect(priceLabels).toHaveLength(1);
      expect(priceLabels2).toHaveLength(0);

      expect(priceLabels?.map((label) => (label as Label).name)).toContain(`Price: ${priceMap[1] * 2} USD`);
      expect(priceLabels2?.map((label) => (label as Label).name)).toHaveLength(0);

      const noTandP = db.issue.findFirst({ where: { id: { equals: 2 } } });
      expect(noTandP?.labels).toHaveLength(0);
    },
    TEST_TIMEOUT
  );

  it(
    "Should update base rate if there are changes in the plugin config",
    async () => {
      const pusher = db.users.findFirst({ where: { id: { equals: 4 } } }) as unknown as Context["payload"]["sender"];
      const commits = inMemoryCommits(STRINGS.SHA_1, true, true);
      const { context, consoleSpies } = innerSetup(
        1,
        commits,
        STRINGS.SHA_1,
        STRINGS.SHA_1,
        {
          owner: STRINGS.UBIQUITY,
          repo: STRINGS.TEST_REPO,
          sha: STRINGS.SHA_1,
          modified: [STRINGS.CONFIG_PATH],
          added: [],
          withBaseRateChanges: true,
          withPlugin: true,
          amount: 5,
        },
        pusher
      );
      await globalLabelUpdate(context);
      expectConsoleToContain(consoleSpies, STRINGS.CONFIG_CHANGED_IN_COMMIT);
      expectConsoleToContain(consoleSpies, STRINGS.EMPTY_COMMITS);
    },
    TEST_TIMEOUT
  );

  it(
    "Should update base rate if the user is authenticated",
    async () => {
      const pusher = db.users.findFirst({ where: { id: { equals: 1 } } }) as unknown as Context["payload"]["sender"];
      const commits = inMemoryCommits(STRINGS.SHA_1, true, true);
      const { context, consoleSpies } = innerSetup(
        1,
        commits,
        STRINGS.SHA_1,
        STRINGS.SHA_1,
        {
          owner: STRINGS.UBIQUITY,
          repo: STRINGS.TEST_REPO,
          sha: STRINGS.SHA_1,
          modified: [STRINGS.CONFIG_PATH],
          added: [],
          withBaseRateChanges: true,
          withPlugin: false,
          amount: 5,
        },
        pusher
      );

      await globalLabelUpdate(context);
      expectConsoleToContain(consoleSpies, STRINGS.CONFIG_CHANGED_IN_COMMIT);
      expectConsoleToContain(consoleSpies, STRINGS.EMPTY_COMMITS);
    },
    TEST_TIMEOUT
  );

  it(
    "Should allow a billing manager to update the base rate",
    async () => {
      const pusher = db.users.findFirst({ where: { id: { equals: 3 } } }) as unknown as Context["payload"]["sender"];
      const commits = inMemoryCommits(STRINGS.SHA_1, false, true, true);
      const { context, consoleSpies } = innerSetup(
        3,
        commits,
        STRINGS.SHA_1,
        STRINGS.SHA_1,
        {
          owner: STRINGS.UBIQUITY,
          repo: STRINGS.TEST_REPO,
          sha: STRINGS.SHA_1,
          modified: [STRINGS.CONFIG_PATH],
          added: [],
          withBaseRateChanges: true,
          withPlugin: true,
          amount: 27, // billing manager's last day
        },
        pusher
      );

      await globalLabelUpdate(context);

      const updatedRepo = db.repo.findFirst({ where: { id: { equals: 1 } } });
      const updatedIssue = db.issue.findFirst({ where: { id: { equals: 1 } } });
      const updatedIssue2 = db.issue.findFirst({ where: { id: { equals: 3 } } });

      expectConsoleToContain(consoleSpies, STRINGS.CONFIG_CHANGED_IN_COMMIT);

      expect(updatedRepo?.labels).toHaveLength(29);
      expect(updatedIssue?.labels).toHaveLength(3);
      expect(updatedIssue2?.labels).toHaveLength(2);

      const priceLabels = updatedIssue?.labels.filter((label) => (label as Label).name.includes("Price:"));
      const priceLabels2 = updatedIssue2?.labels.filter((label) => (label as Label).name.includes("Price:"));

      expect(priceLabels).toHaveLength(1);
      expect(priceLabels2).toHaveLength(0);

      expect(priceLabels?.map((label) => (label as Label).name)).toContain(`Price: ${priceMap[1] * 2} USD`);
      expect(priceLabels2?.map((label) => (label as Label).name)).toHaveLength(0);

      const sender_ = context.payload.sender;

      expect(pusher?.name).toBe("billing");
      expect(sender_?.login).toBe("billing");
    },
    TEST_TIMEOUT
  );

  it(
    "Should update if auth pushes the code and billing manager merges the PR",
    async () => {
      const pusher = db.users.findFirst({ where: { id: { equals: 3 } } }) as unknown as Context["payload"]["sender"];
      const commits = inMemoryCommits(STRINGS.SHA_1, true, true, true);
      const { context } = innerSetup(
        1,
        commits,
        STRINGS.SHA_1,
        STRINGS.SHA_1,
        {
          owner: STRINGS.UBIQUITY,
          repo: STRINGS.TEST_REPO,
          sha: STRINGS.SHA_1,
          modified: [STRINGS.CONFIG_PATH],
          added: [],
          withBaseRateChanges: true,
          withPlugin: true,
          amount: 8.5,
        },
        pusher
      );

      await globalLabelUpdate(context);

      const updatedRepo = db.repo.findFirst({ where: { id: { equals: 1 } } });
      const updatedIssue = db.issue.findFirst({ where: { id: { equals: 1 } } });
      const updatedIssue2 = db.issue.findFirst({ where: { id: { equals: 3 } } });

      expect(updatedRepo?.labels).toHaveLength(29);
      expect(updatedIssue?.labels).toHaveLength(3);
      expect(updatedIssue2?.labels).toHaveLength(2);

      const priceLabels = updatedIssue?.labels.filter((label) => (label as Label).name.includes("Price:"));
      const priceLabels2 = updatedIssue2?.labels.filter((label) => (label as Label).name.includes("Price:"));

      expect(priceLabels).toHaveLength(1);
      expect(priceLabels2).toHaveLength(0);

      expect(priceLabels?.map((label) => (label as Label).name)).toContain(`Price: ${priceMap[1] * 2} USD`);
      expect(priceLabels2?.map((label) => (label as Label).name)).toHaveLength(0);
    },
    TEST_TIMEOUT
  );

  it(
    "Should not globally update excluded repos",
    async () => {
      const pusher = db.users.findFirst({ where: { id: { equals: 1 } } }) as unknown as Context["payload"]["sender"];
      const commits = inMemoryCommits(STRINGS.SHA_1);
      const { context, consoleSpies } = innerSetup(
        1,
        commits,
        STRINGS.SHA_1,
        STRINGS.SHA_1,
        {
          owner: STRINGS.UBIQUITY,
          repo: STRINGS.TEST_REPO,
          sha: STRINGS.SHA_1,
          modified: [STRINGS.CONFIG_PATH],
          added: [],
          withBaseRateChanges: true,
          withPlugin: false,
          amount: 5,
        },
        pusher,
        {
          excludeRepos: [STRINGS.TEST_REPO],
        }
      );

      await globalLabelUpdate(context);

      expectConsoleToContain(consoleSpies, STRINGS.CONFIG_CHANGED_IN_COMMIT);
      expectConsoleToContain(consoleSpies, STRINGS.EMPTY_COMMITS);
    },
    TEST_TIMEOUT
  );

  it(
    "Should not globally update if it's disabled",
    async () => {
      const pusher = db.users.findFirst({ where: { id: { equals: 1 } } }) as unknown as Context["payload"]["sender"];
      const commits = inMemoryCommits(STRINGS.SHA_1);
      const { context, consoleSpies } = innerSetup(
        1,
        commits,
        STRINGS.SHA_1,
        STRINGS.SHA_1,
        {
          owner: STRINGS.UBIQUITY,
          repo: STRINGS.TEST_REPO,
          sha: STRINGS.SHA_1,
          modified: [STRINGS.CONFIG_PATH],
          added: [],
          withBaseRateChanges: true,
          withPlugin: false,
          amount: 5,
        },
        pusher
      );
      context.config.globalConfigUpdate = undefined;
      await globalLabelUpdate(context);

      expectConsoleToContain(consoleSpies, STRINGS.CONFIG_CHANGED_IN_COMMIT);
      expectConsoleToContain(consoleSpies, STRINGS.EMPTY_COMMITS);
    },
    TEST_TIMEOUT
  );

  it(
    "Should not update base rate if the user is not authenticated",
    async () => {
      const pusher = db.users.findFirst({ where: { id: { equals: 2 } } }) as unknown as Context["payload"]["sender"];
      const commits = inMemoryCommits(STRINGS.SHA_1, false);
      const { context, consoleSpies } = innerSetup(
        2,
        commits,
        STRINGS.SHA_1,
        STRINGS.SHA_1,
        {
          owner: STRINGS.USER_2,
          repo: STRINGS.TEST_REPO,
          sha: STRINGS.SHA_1,
          modified: [STRINGS.CONFIG_PATH],
          added: [],
          withBaseRateChanges: true,
          withPlugin: false,
          amount: 5,
        },
        pusher
      );

      await globalLabelUpdate(context);
      expectConsoleToContain(consoleSpies, STRINGS.PUSHER_NOT_AUTHED);
      expectConsoleToContain(consoleSpies, STRINGS.SENDER_NOT_AUTHED);
      expectConsoleToContain(consoleSpies, STRINGS.NEEDS_TRIGGERED_BY_ADMIN_OR_BILLING_MANAGER);
    },
    TEST_TIMEOUT
  );

  it(
    "Should not update base rate if there are no changes",
    async () => {
      const pusher = db.users.findFirst({ where: { id: { equals: 1 } } }) as unknown as Context["payload"]["sender"];
      const commits = inMemoryCommits(STRINGS.SHA_1, true, false);
      const { context, consoleSpies } = innerSetup(
        1,
        commits,
        STRINGS.SHA_1,
        STRINGS.SHA_1,
        {
          owner: STRINGS.UBIQUITY,
          repo: STRINGS.TEST_REPO,
          sha: STRINGS.SHA_1,
          modified: [],
          added: [],
          withBaseRateChanges: false,
          withPlugin: false,
          amount: 5,
        },
        pusher
      );

      await globalLabelUpdate(context);
      expectConsoleToContain(consoleSpies, "No files were changed in the commits, so no action is required.");
    },
    TEST_TIMEOUT
  );

  it(
    "Should not update if non-auth pushes the code and admin merges the PR",
    async () => {
      const commits = inMemoryCommits(STRINGS.SHA_1, false, true, true);
      const pusher = db.users.findFirst({ where: { id: { equals: 2 } } }) as unknown as Context["payload"]["sender"];
      const { context, consoleSpies } = innerSetup(
        1,
        commits,
        STRINGS.SHA_1,
        STRINGS.SHA_1,
        {
          owner: STRINGS.UBIQUITY,
          repo: STRINGS.TEST_REPO,
          sha: STRINGS.SHA_1,
          modified: [STRINGS.CONFIG_PATH],
          added: [],
          withBaseRateChanges: true,
          withPlugin: true,
          amount: 5,
        },
        pusher
      );

      await globalLabelUpdate(context);
      expectConsoleToContain(consoleSpies, STRINGS.PUSHER_NOT_AUTHED);
      expectConsoleToContain(consoleSpies, STRINGS.NEEDS_TRIGGERED_BY_ADMIN_OR_BILLING_MANAGER);
      expectConsoleNotToContain(consoleSpies, STRINGS.CONFIG_CHANGED_IN_COMMIT);
    },
    TEST_TIMEOUT
  );

  it(
    "Should not update if non-auth pushes the code and billing manager merges the PR",
    async () => {
      const commits = inMemoryCommits(STRINGS.SHA_1, false, true, true);
      const pusher = db.users.findFirst({ where: { id: { equals: 2 } } }) as unknown as Context["payload"]["sender"];
      const { context, consoleSpies } = innerSetup(
        3,
        commits,
        STRINGS.SHA_1,
        STRINGS.SHA_1,
        {
          owner: STRINGS.UBIQUITY,
          repo: STRINGS.TEST_REPO,
          sha: STRINGS.SHA_1,
          modified: [STRINGS.CONFIG_PATH],
          added: [],
          withBaseRateChanges: true,
          withPlugin: true,
          amount: 5,
        },
        pusher
      );

      await globalLabelUpdate(context);
      expectConsoleToContain(consoleSpies, STRINGS.PUSHER_NOT_AUTHED);
      expectConsoleToContain(consoleSpies, STRINGS.NEEDS_TRIGGERED_BY_ADMIN_OR_BILLING_MANAGER);
    },
    TEST_TIMEOUT
  );

  it(
    "Should not update if auth pushes the code and non-auth merges the PR",
    async () => {
      const pusher = db.users.findFirst({ where: { id: { equals: 1 } } }) as unknown as Context["payload"]["sender"];
      const commits = inMemoryCommits(STRINGS.SHA_1, true, true, true);
      const { context, consoleSpies } = innerSetup(
        2,
        commits,
        STRINGS.SHA_1,
        STRINGS.SHA_1,
        {
          owner: STRINGS.UBIQUITY,
          repo: STRINGS.TEST_REPO,
          sha: STRINGS.SHA_1,
          modified: [STRINGS.CONFIG_PATH],
          added: [],
          withBaseRateChanges: true,
          withPlugin: true,
          amount: 5,
        },
        pusher
      );

      await globalLabelUpdate(context);
      expectConsoleToContain(consoleSpies, STRINGS.SENDER_NOT_AUTHED);
      expectConsoleToContain(consoleSpies, STRINGS.NEEDS_TRIGGERED_BY_ADMIN_OR_BILLING_MANAGER);
    },
    TEST_TIMEOUT
  );

  it(
    "Should not update base rate if a new branch was created",
    async () => {
      const pusher = db.users.findFirst({ where: { id: { equals: 1 } } }) as unknown as Context["payload"]["sender"];
      const commits = inMemoryCommits(STRINGS.SHA_1);
      const { context, consoleSpies } = innerSetup(
        3,
        commits,
        ZERO_SHA,
        STRINGS.SHA_1,
        {
          owner: STRINGS.UBIQUITY,
          repo: STRINGS.TEST_REPO,
          sha: STRINGS.SHA_1,
          modified: [STRINGS.CONFIG_PATH],
          added: [],
          withBaseRateChanges: true,
          withPlugin: false,
          amount: 5,
        },
        pusher
      );

      await globalLabelUpdate(context);
      expectConsoleToContain(consoleSpies, "Skipping push events. A new branch was created");
      expectConsoleToContain(consoleSpies, "No label changes found in the diff");
    },
    TEST_TIMEOUT
  );
});

type ConsoleSpies = {
  debugSpy: jest.SpiedFunction<typeof console.debug>;
  infoSpy: jest.SpiedFunction<typeof console.info>;
  logSpy: jest.SpiedFunction<typeof console.log>;
  warnSpy: jest.SpiedFunction<typeof console.warn>;
  errorSpy: jest.SpiedFunction<typeof console.error>;
};

function createConsoleSpies(): ConsoleSpies {
  return {
    debugSpy: jest.spyOn(console, "debug").mockImplementation(() => undefined),
    infoSpy: jest.spyOn(console, "info").mockImplementation(() => undefined),
    logSpy: jest.spyOn(console, "log").mockImplementation(() => undefined),
    warnSpy: jest.spyOn(console, "warn").mockImplementation(() => undefined),
    errorSpy: jest.spyOn(console, "error").mockImplementation(() => undefined),
  };
}

function consoleSpiesContain(spies: ConsoleSpies, needle: string): boolean {
  const allCalls = [
    ...spies.debugSpy.mock.calls,
    ...spies.infoSpy.mock.calls,
    ...spies.logSpy.mock.calls,
    ...spies.warnSpy.mock.calls,
    ...spies.errorSpy.mock.calls,
  ];
  return allCalls.some((args) => args.some((arg: unknown) => typeof arg === "string" && arg.includes(needle)));
}

function expectConsoleToContain(spies: ConsoleSpies, needle: string) {
  expect(consoleSpiesContain(spies, needle)).toBe(true);
}

function expectConsoleNotToContain(spies: ConsoleSpies, needle: string) {
  expect(consoleSpiesContain(spies, needle)).toBe(false);
}

function innerSetup(
  senderId: number,
  commits: Context<"push">["payload"]["commits"],
  before: string,
  after: string,
  commitParams: CreateCommitParams,
  pusher?: Context["payload"]["sender"],
  globalConfigUpdate?: {
    excludeRepos: string[];
  }
) {
  const sender = db.users.findFirst({ where: { id: { equals: senderId } } }) as unknown as Context["payload"]["sender"];

  createCommit(commitParams);

  const context = createContext(sender, commits, before, after, pusher, globalConfigUpdate);

  const consoleSpies = createConsoleSpies();

  const repo = db.repo.findFirst({ where: { id: { equals: 1 } } });
  const issue1 = db.issue.findFirst({ where: { id: { equals: 1 } } });
  const issue2 = db.issue.findFirst({ where: { id: { equals: 3 } } });

  expect(repo?.labels).toHaveLength(29);
  expect(issue1?.labels).toHaveLength(3);
  expect(issue2?.labels).toHaveLength(2);

  return {
    context,
    consoleSpies,
    repo,
    issue1,
    issue2,
  };
}

function createContext(
  sender: Context["payload"]["sender"],
  commits: Context<"push">["payload"]["commits"],
  before: string,
  after: string,
  pusher?: Context["payload"]["sender"],
  globalConfigUpdate?: {
    excludeRepos: string[];
  }
) {
  return {
    adapters: {} as never,
    payload: {
      action: "created",
      sender: sender as unknown as Context["payload"]["sender"],
      repository: db.repo.findFirst({ where: { id: { equals: 1 } } }) as unknown as Context["payload"]["repository"],
      installation: { id: 1 } as unknown as Context["payload"]["installation"],
      organization: { login: STRINGS.UBIQUITY } as unknown as Context["payload"]["organization"],
      after,
      before,
      base_ref: "refs/heads/main",
      ref: "refs/heads/main",
      commits,
      compare: "",
      created: false,
      deleted: false,
      forced: false,
      head_commit: {
        id: STRINGS.SHA_1,
        message: "feat: add base rate",
        timestamp: new Date().toISOString(),
        url: "",
        author: {
          email: STRINGS.EMAIL,
          name: STRINGS.UBIQUITY,
          username: STRINGS.UBIQUITY,
        },
        committer: {
          email: STRINGS.EMAIL,
          name: STRINGS.UBIQUITY,
          username: STRINGS.UBIQUITY,
        },
        added: [STRINGS.CONFIG_PATH],
        modified: [],
        removed: [],
        distinct: true,
        tree_id: STRINGS.SHA_1,
      },
      pusher: {
        name: pusher?.login ?? sender?.login,
        email: "...",
        date: new Date().toISOString(),
        username: pusher?.login ?? sender?.login,
      },
    },
    logger: new Logs("debug"),
    config: {
      labels: {
        priority: PRIORITY_LABELS.map((label) => ({
          name: label.name,
          collaboratorOnly: false,
        })),
      },
      shouldFundContributorClosedIssue: false,
      globalConfigUpdate: globalConfigUpdate ?? {
        excludeRepos: [],
      },
      basePriceMultiplier: 2,
    },
    octokit: new Octokit({
      throttle: { enabled: false },
    }),
    eventName: "push",
    command: null,
  } as unknown as Context<"push">;
}
