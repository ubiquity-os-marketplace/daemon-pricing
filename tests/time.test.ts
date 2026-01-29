import { beforeAll, jest } from "@jest/globals";
import { Context } from "../src/types/context";

const logger = {
  ok: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
(logger.warn as jest.Mock).mockImplementation((...args: unknown[]) => {
  const msg = String(args[0]);
  if (msg.includes("can only be used in issue comments") || msg.includes("Only admins or the issue author can set time estimates.")) {
    throw new Error(msg);
  }
});

const mockReactions = {
  "+1": 0,
  "-1": 0,
  confused: 0,
  eyes: 0,
  heart: 0,
  hooray: 0,
  laugh: 0,
  rocket: 0,
  total_count: 0,
  url: "",
};

const mockUser = {
  login: "user1",
  id: 1,
  avatar_url: "",
  url: "",
  type: "User" as const,
};

const mockIssue = {
  active_lock_reason: null,
  assignee: null,
  assignees: [],
  author_association: "NONE" as const,
  body: "",
  closed_at: null,
  comments: 0,
  comments_url: "",
  created_at: "",
  events_url: "",
  html_url: "",
  id: 1,
  labels: [{ name: "Time: 1h" }, { name: "bug" }],
  labels_url: "",
  locked: false,
  milestone: null,
  node_id: "",
  number: 1,
  performed_via_github_app: null,
  reactions: mockReactions,
  repository_url: "",
  state: "open" as "open" | "closed",
  timeline_url: "",
  title: "",
  updated_at: "",
  url: "",
  user: { ...mockUser },
};

const mockAddLabelToIssue = jest.fn();
const mockRemoveLabelFromIssue = jest.fn();
const mockCreateLabel = jest.fn();
type MockLlmResponse = { choices: { message: { content: string } }[] };
type IsUserAdminOrBillingManagerReturn = "admin" | "billing_manager" | false;
const mockCallLlm = jest.fn<() => Promise<MockLlmResponse>>();
const mockSanitizeLlmResponse = jest.fn((input: string) => input);

jest.mock("@ubiquity-os/plugin-sdk", () => ({
  callLlm: mockCallLlm,
  sanitizeLlmResponse: mockSanitizeLlmResponse,
}));
jest.mock("../src/shared/label", () => ({
  addLabelToIssue: mockAddLabelToIssue,
  removeLabelFromIssue: mockRemoveLabelFromIssue,
  createLabel: mockCreateLabel,
}));
jest.mock("../src/shared/issue", () => ({
  isUserAdminOrBillingManager: jest.fn(async () => "admin"),
}));

let ensureTimeLabelOnIssueOpened: typeof import("../src/utils/time").ensureTimeLabelOnIssueOpened;
let setTimeLabel: typeof import("../src/utils/time").setTimeLabel;
let time: typeof import("../src/utils/time").time;
let parseTimeInput: typeof import("../src/utils/time-labels").parseTimeInput;

beforeAll(async () => {
  ({ ensureTimeLabelOnIssueOpened, setTimeLabel, time } = await import("../src/utils/time"));
  ({ parseTimeInput } = await import("../src/utils/time-labels"));
});

function makeContext(
  overrides: Partial<Context<"issue_comment.created">> = {},
  userOverride: Partial<typeof mockUser> = {},
  issueOverride: Partial<typeof mockIssue> = {}
): Context<"issue_comment.created"> {
  const user = { ...mockUser, ...userOverride };
  const issue = { ...mockIssue, ...issueOverride };
  const octokit = {
    rest: {
      issues: {
        addLabels: jest.fn(),
        removeLabel: jest.fn(),
        createLabel: jest.fn(),
        listLabelsForRepo: jest.fn(),
      },
      repos: {
        getCollaboratorPermissionLevel: jest.fn(() => ({
          data: {
            permission: "admin",
            role_name: "write",
          },
        })),
        listForOrg: jest.fn(),
        getCommit: jest.fn(),
      },
      orgs: {
        checkMembershipForUser: jest.fn(),
        getMembershipForUser: jest.fn(),
      },
      git: {
        getRef: jest.fn(),
        getCommit: jest.fn(),
        createCommit: jest.fn(),
        updateRef: jest.fn(),
      },
    },
    paginate: jest.fn(),
  };
  return {
    logger,
    config: {
      llmModel: {
        reasoningEffort: "low",
      },
      labels: {
        priority: [],
      },
      basePriceMultiplier: 1,
      shouldFundContributorClosedIssue: false,
    },
    payload: {
      action: "created",
      repository: {
        owner: { login: "owner" },
        name: "repo",
      },
      sender: { login: user.login },
      issue,
      comment: {
        author_association: "NONE",
        body: "/time 2h",
        html_url: "",
        id: 1,
        node_id: "",
        user,
        created_at: "",
        updated_at: "",
        url: "",
        reactions: mockReactions,
        issue_url: "",
        performed_via_github_app: null,
      },
    },
    octokit,
    ...overrides,
  } as unknown as Context<"issue_comment.created">;
}

function makeIssueOpenedContext(overrides: Partial<Context<"issues.opened">> = {}, issueOverride: Partial<typeof mockIssue> = {}): Context<"issues.opened"> {
  const issue = { ...mockIssue, ...issueOverride };
  const octokit = {
    rest: {
      issues: {
        addLabels: jest.fn(),
        removeLabel: jest.fn(),
        createLabel: jest.fn(),
        listLabelsForRepo: jest.fn(),
      },
      repos: {
        getCollaboratorPermissionLevel: jest.fn(() => ({
          data: {
            permission: "admin",
            role_name: "write",
          },
        })),
        listForOrg: jest.fn(),
        getCommit: jest.fn(),
      },
      orgs: {
        checkMembershipForUser: jest.fn(),
        getMembershipForUser: jest.fn(),
      },
      git: {
        getRef: jest.fn(),
        getCommit: jest.fn(),
        createCommit: jest.fn(),
        updateRef: jest.fn(),
      },
    },
    paginate: jest.fn(),
  };
  return {
    eventName: "issues.opened",
    logger,
    config: {
      llmModel: {
        reasoningEffort: "low",
      },
      labels: {
        priority: [],
      },
      basePriceMultiplier: 1,
      shouldFundContributorClosedIssue: false,
    },
    payload: {
      action: "opened",
      repository: {
        owner: { login: "owner" },
        name: "repo",
      },
      sender: { login: mockUser.login },
      issue,
    },
    octokit,
    ...overrides,
  } as unknown as Context<"issues.opened">;
}

describe("setTimeLabel", () => {
  beforeEach(async () => {
    jest.mock("../src/shared/issue", () => ({
      isUserAdminOrBillingManager: jest.fn(),
    }));
    jest.clearAllMocks();
    const { isUserAdminOrBillingManager } = await import("../src/shared/issue");
    (isUserAdminOrBillingManager as jest.Mock<() => Promise<IsUserAdminOrBillingManagerReturn>>).mockResolvedValue("admin");
  });

  it("throws if not issue comment event", async () => {
    jest.resetModules();
    jest.mock("../src/types/typeguards", () => ({
      isIssueCommentEvent: () => false,
    }));
    const context = makeContext();
    await expect(setTimeLabel(context, "2h")).rejects.toThrow();
  });

  it("allows admin to set time", async () => {
    const { isUserAdminOrBillingManager } = await import("../src/shared/issue");
    (isUserAdminOrBillingManager as jest.Mock<() => Promise<IsUserAdminOrBillingManagerReturn>>).mockResolvedValue("admin");
    const context = makeContext(
      {
        payload: {
          action: "created",
          repository: { owner: { login: "owner" }, name: "repo" },
          sender: { login: "admin" },
          issue: { ...mockIssue, user: { login: "user2", id: 3, avatar_url: "", url: "", type: "User" as const }, labels: [] },
          comment: {
            author_association: "NONE",
            body: "/time 2h",
            html_url: "",
            id: 1,
            node_id: "",
            user: { ...mockUser, login: "admin", id: 2, type: "User" as const },
            created_at: "",
            updated_at: "",
            url: "",
            reactions: mockReactions,
            issue_url: "",
            performed_via_github_app: null,
          },
        } as unknown as Context<"issue_comment.created">["payload"],
      },
      { login: "admin", id: 2, type: "User" as const }
    );
    (context.octokit.paginate as unknown as jest.Mock).mockImplementation(() =>
      Promise.resolve([{ name: "Time: 2 Hours" }, { name: "Time: 15 Minutes" }, { name: "Time: 1 Week" }])
    );
    await setTimeLabel(context, "2h");
    expect(mockRemoveLabelFromIssue).not.toHaveBeenCalled();
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(expect.anything(), "Time: 2 Hours");
  });

  it("allows author to set time", async () => {
    const context = makeContext(
      {
        payload: {
          action: "created",
          repository: { owner: { login: "owner" }, name: "repo" },
          sender: { login: "user2" },
          issue: { ...mockIssue, user: { login: "user2", id: 3, avatar_url: "", url: "", type: "User" as const }, labels: [] },
          comment: {
            author_association: "NONE",
            body: "/time 2h",
            html_url: "",
            id: 1,
            node_id: "",
            user: { ...mockUser, login: "user2", id: 3, type: "User" as const },
            created_at: "",
            updated_at: "",
            url: "",
            reactions: mockReactions,
            issue_url: "",
            performed_via_github_app: null,
          },
        } as unknown as Context<"issue_comment.created">["payload"],
      },
      { login: "user2", id: 3, type: "User" as const }
    );
    (context.octokit.paginate as unknown as jest.Mock).mockImplementation(() =>
      Promise.resolve([{ name: "Time: 2 Hours" }, { name: "Time: 15 Minutes" }, { name: "Time: 1 Week" }])
    );
    await setTimeLabel(context, "2h");
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(context, "Time: 2 Hours");
  });

  it("removes existing time labels before adding new one", async () => {
    const { isUserAdminOrBillingManager } = await import("../src/shared/issue");
    (isUserAdminOrBillingManager as jest.Mock<() => Promise<IsUserAdminOrBillingManagerReturn>>).mockResolvedValue("admin");
    const context = makeContext(
      {
        payload: {
          action: "created",
          repository: { owner: { login: "owner" }, name: "repo" },
          sender: { login: "admin" },
          issue: {
            ...mockIssue,
            user: { login: "user2", id: 3, avatar_url: "", url: "", type: "User" as const },
            labels: [{ name: "Time: 1h" }, { name: "Time: 3h" }],
          },
          comment: {
            author_association: "NONE",
            body: "/time 2h",
            html_url: "",
            id: 1,
            node_id: "",
            user: { ...mockUser, login: "admin", id: 2, type: "User" as const },
            created_at: "",
            updated_at: "",
            url: "",
            reactions: mockReactions,
            issue_url: "",
            performed_via_github_app: null,
          },
        } as unknown as Context<"issue_comment.created">["payload"],
      },
      { login: "admin", id: 2, type: "User" as const }
    );
    (context.octokit.paginate as unknown as jest.Mock).mockImplementation(() =>
      Promise.resolve([{ name: "Time: 2 Hours" }, { name: "Time: 15 Minutes" }, { name: "Time: 1 Week" }])
    );
    await setTimeLabel(context, "2h");
    expect(mockRemoveLabelFromIssue).toHaveBeenCalledTimes(2);
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(context, "Time: 2 Hours");
  });

  it("throws if not admin or author", async () => {
    const { isUserAdminOrBillingManager } = await import("../src/shared/issue");
    (isUserAdminOrBillingManager as jest.Mock<() => Promise<IsUserAdminOrBillingManagerReturn>>).mockResolvedValue(false);
    const context = makeContext({
      payload: {
        sender: { login: "outsider" },
        issue: { ...mockIssue, user: { ...mockUser, login: "owner" }, labels: [{ name: "Time: 1h" }] },
      } as unknown as Context<"issue_comment.created">["payload"],
    });
    (
      context.octokit.rest.repos.getCollaboratorPermissionLevel as unknown as jest.Mock<() => Promise<{ data: { permission: string; role_name: string } }>>
    ).mockResolvedValue({
      data: { permission: "read", role_name: "read" },
    });
    (context.octokit.rest.orgs.getMembershipForUser as unknown as jest.Mock<() => Promise<unknown>>).mockRejectedValue(new Error("not a member"));
    await expect(setTimeLabel(context, "2h")).rejects.toThrow();
  });
});

describe("parseTimeInput", () => {
  it("parses compact multi-unit inputs", () => {
    expect(parseTimeInput("1h30m")).toEqual({ value: 1.5, unit: "hour" });
  });

  it("parses multi-unit inputs with words", () => {
    expect(parseTimeInput("1 hour and 30 minutes")).toEqual({ value: 1.5, unit: "hour" });
  });
});

describe("time", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    const { isUserAdminOrBillingManager } = await import("../src/shared/issue");
    (isUserAdminOrBillingManager as jest.Mock<() => Promise<IsUserAdminOrBillingManagerReturn>>).mockResolvedValue("admin");
  });

  it("calls setTimeLabel with parsed input", async () => {
    const context = makeContext(
      {
        payload: {
          action: "created",
          repository: { owner: { login: "owner" }, name: "repo" },
          comment: {
            author_association: "NONE",
            body: "/time 5h",
            html_url: "",
            id: 1,
            node_id: "",
            user: { ...mockUser, login: "admin", id: 2, type: "User" as const },
            created_at: "",
            updated_at: "",
            url: "",
            reactions: mockReactions,
            issue_url: "",
            performed_via_github_app: null,
          },
          sender: { login: "admin" },
          issue: { ...mockIssue, user: { login: "user2", id: 3, avatar_url: "", url: "", type: "User" as const }, labels: [] },
        } as unknown as Context<"issue_comment.created">["payload"],
      },
      { login: "admin", id: 2, type: "User" as const }
    );
    (context.octokit.paginate as unknown as jest.Mock).mockImplementation(() =>
      Promise.resolve([{ name: "Time: 5 Hours" }, { name: "Time: 15 Minutes" }, { name: "Time: 1 Week" }])
    );
    await time(context);
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(context, "Time: 5 Hours");
  });

  it("uses LLM when no duration is provided", async () => {
    mockCallLlm.mockResolvedValue({
      choices: [{ message: { content: "2 hours" } }],
    });
    const context = makeContext(
      {
        payload: {
          action: "created",
          repository: { owner: { login: "owner" }, name: "repo" },
          comment: {
            author_association: "NONE",
            body: "/time",
            html_url: "",
            id: 1,
            node_id: "",
            user: { ...mockUser, login: "admin", id: 2, type: "User" as const },
            created_at: "",
            updated_at: "",
            url: "",
            reactions: mockReactions,
            issue_url: "",
            performed_via_github_app: null,
          },
          sender: { login: "admin" },
          issue: { ...mockIssue, title: "Add cache", body: "Implement a small cache for API results.", labels: [] },
        } as unknown as Context<"issue_comment.created">["payload"],
      },
      { login: "admin", id: 2, type: "User" as const }
    );
    (context.octokit.paginate as unknown as jest.Mock).mockImplementation(() =>
      Promise.resolve([{ name: "Time: 2 Hours" }, { name: "Time: 15 Minutes" }, { name: "Time: 1 Week" }])
    );
    await time(context);
    expect(mockCallLlm).toHaveBeenCalled();
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(context, "Time: 2 Hours");
  });

  it("warns if command is not /time", async () => {
    const context = makeContext(
      {
        payload: {
          action: "created",
          repository: { owner: { login: "owner" }, name: "repo" },
          comment: {
            author_association: "NONE",
            body: "/notatime 5h",
            html_url: "",
            id: 1,
            node_id: "",
            user: { ...mockUser, login: "admin", id: 2, type: "User" as const },
            created_at: "",
            updated_at: "",
            url: "",
            reactions: mockReactions,
            issue_url: "",
            performed_via_github_app: null,
          },
          sender: { login: "admin" },
          issue: { ...mockIssue, user: { login: "user2", id: 3, avatar_url: "", url: "", type: "User" as const }, labels: [] },
        } as unknown as Context<"issue_comment.created">["payload"],
      },
      { login: "admin", id: 2, type: "User" as const }
    );
    const warnSpy = jest.spyOn(context.logger, "warn");
    await time(context);
    expect(warnSpy).toHaveBeenCalledWith("The command notatime is not supported.");
  });
});

describe("ensureTimeLabelOnIssueOpened", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("skips estimation when a time label already exists", async () => {
    const context = makeIssueOpenedContext({
      payload: {
        action: "opened",
        repository: { owner: { login: "owner" }, name: "repo" },
        sender: { login: mockUser.login },
        issue: { ...mockIssue, labels: [{ name: "Time: 1 Hour" }] },
      } as unknown as Context<"issues.opened">["payload"],
    });
    await ensureTimeLabelOnIssueOpened(context);
    expect(mockCallLlm).not.toHaveBeenCalled();
    expect(mockAddLabelToIssue).not.toHaveBeenCalled();
  });

  it("estimates and adds a time label when none exists", async () => {
    mockCallLlm.mockResolvedValue({
      choices: [{ message: { content: "2 hours" } }],
    });
    const context = makeIssueOpenedContext({
      payload: {
        action: "opened",
        repository: { owner: { login: "owner" }, name: "repo" },
        sender: { login: mockUser.login },
        issue: { ...mockIssue, title: "Speed up tests", body: "Parallelize slow suites.", labels: [] },
      } as unknown as Context<"issues.opened">["payload"],
    });
    (context.octokit.paginate as unknown as jest.Mock).mockImplementation(() =>
      Promise.resolve([{ name: "Time: 2 Hours" }, { name: "Time: 15 Minutes" }, { name: "Time: 1 Week" }])
    );
    await ensureTimeLabelOnIssueOpened(context);
    expect(mockCallLlm).toHaveBeenCalled();
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(context, "Time: 2 Hours");
  });
});
