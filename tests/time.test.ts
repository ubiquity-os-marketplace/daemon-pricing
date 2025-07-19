import { jest } from "@jest/globals";
import { Context } from "../src/types/context";

const logger = {
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

jest.unstable_mockModule("../src/shared/label", () => ({
  addLabelToIssue: mockAddLabelToIssue,
  removeLabelFromIssue: mockRemoveLabelFromIssue,
}));
jest.unstable_mockModule("../src/shared/issue", () => ({
  isUserAdminOrBillingManager: jest.fn(() => "admin"),
}));

const { setTimeLabel, time } = await import("../src/utils/time");

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

describe("setTimeLabel", () => {
  beforeEach(async () => {
    jest.unstable_mockModule("../src/utils/time-labels", () => ({
      findClosestTimeLabel: jest.fn(),
    }));
    jest.unstable_mockModule("../src/shared/issue", () => ({
      isUserAdminOrBillingManager: jest.fn(),
    }));
    jest.clearAllMocks();
    const { findClosestTimeLabel } = await import("../src/utils/time-labels");
    const { isUserAdminOrBillingManager } = await import("../src/shared/issue");
    (findClosestTimeLabel as jest.Mock<() => Promise<string>>).mockResolvedValue("Time: <2h");
    (isUserAdminOrBillingManager as jest.Mock<() => Promise<string>>).mockResolvedValue("admin");
  });

  it("throws if not issue comment event", async () => {
    jest.resetModules();
    jest.unstable_mockModule("../src/types/typeguards", () => ({
      isIssueCommentEvent: () => false,
    }));
    const context = makeContext();
    await expect(setTimeLabel(context, "2h")).rejects.toThrow();
  });

  it("allows admin to set time", async () => {
    const { isUserAdminOrBillingManager } = await import("../src/shared/issue");
    (isUserAdminOrBillingManager as jest.Mock<() => Promise<string>>).mockResolvedValue("admin");
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
      Promise.resolve([{ name: "Time: <2h" }, { name: "Time: <15 Minutes" }, { name: "Time: <1 Week" }])
    );
    await setTimeLabel(context, "2h");
    expect(mockRemoveLabelFromIssue).not.toHaveBeenCalled();
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(expect.anything(), "Time: <2h");
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
      Promise.resolve([{ name: "Time: <2h" }, { name: "Time: <15 Minutes" }, { name: "Time: <1 Week" }])
    );
    await setTimeLabel(context, "2h");
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(context, "Time: <2h");
  });

  it("removes existing time labels before adding new one", async () => {
    const { isUserAdminOrBillingManager } = await import("../src/shared/issue");
    (isUserAdminOrBillingManager as jest.Mock<() => Promise<string>>).mockResolvedValue("admin");
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
      Promise.resolve([{ name: "Time: <2h" }, { name: "Time: <15 Minutes" }, { name: "Time: <1 Week" }])
    );
    await setTimeLabel(context, "2h");
    expect(mockRemoveLabelFromIssue).toHaveBeenCalledTimes(2);
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(context, "Time: <2h");
  });

  it("throws if not admin or author", async () => {
    const context = makeContext();
    await expect(setTimeLabel(context, "2h")).rejects.toThrow();
  });
});

describe("time", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.unstable_mockModule("../src/utils/time-labels", () => ({
      findClosestTimeLabel: jest.fn(),
    }));
    const { findClosestTimeLabel } = await import("../src/utils/time-labels");
    const { isUserAdminOrBillingManager } = await import("../src/shared/issue");
    (findClosestTimeLabel as jest.Mock<() => Promise<string>>).mockResolvedValue("Time: 2h");
    (isUserAdminOrBillingManager as jest.Mock<() => Promise<boolean>>).mockResolvedValue(true);
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
      Promise.resolve([{ name: "Time: <2h" }, { name: "Time: <15 Minutes" }, { name: "Time: <1 Week" }])
    );
    await time(context);
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(context, "Time: <1 Week");
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
