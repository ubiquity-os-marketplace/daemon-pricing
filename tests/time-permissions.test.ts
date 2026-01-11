import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Context } from "../src/types/context";

const logger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
const warnThrowMessages = ["The `/time` command can only be used in issue comments."];
(logger.warn as jest.Mock).mockImplementation((...args: unknown[]) => {
  const msg = String(args[0]);
  if (warnThrowMessages.some((text) => msg.includes(text))) {
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
  login: "author",
  id: 1,
  avatar_url: "",
  url: "",
  type: "User" as const,
};

const baseIssue = {
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
  labels: [] as Array<{ name: string }>,
  labels_url: "",
  locked: false,
  milestone: null,
  node_id: "",
  number: 42,
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

jest.mock("../src/shared/label", () => ({
  addLabelToIssue: mockAddLabelToIssue,
  removeLabelFromIssue: mockRemoveLabelFromIssue,
  createLabel: mockCreateLabel,
}));

// We'll inject behavior based on username
const isUserAdminOrBillingManagerMock = jest.fn(async (ctxParam: unknown, username?: string) => {
  if (!username) return false;
  return username === "admin" ? "admin" : false;
});

jest.mock("../src/shared/issue", () => ({
  isUserAdminOrBillingManager: isUserAdminOrBillingManagerMock,
}));

let setTimeLabel: typeof import("../src/utils/time").setTimeLabel;

beforeAll(async () => {
  ({ setTimeLabel } = await import("../src/utils/time"));
});

function makeContext({
  sender,
  issueLabels,
  events,
  authorLogin = "author",
  org = undefined as undefined | string,
}: {
  sender: string;
  issueLabels: string[];
  events: Array<{ event: string; label?: { name: string }; actor?: { login: string } }>;
  authorLogin?: string;
  org?: string;
}) {
  const issue = { ...baseIssue, user: { ...mockUser, login: authorLogin }, labels: issueLabels.map((name) => ({ name })) };
  const octokit = {
    rest: {
      issues: {
        listEvents: jest.fn(),
        listLabelsForRepo: jest.fn(),
      },
      repos: {
        getCollaboratorPermissionLevel: jest.fn(({ username }: { username: string }) => {
          if (username === "collab") return { data: { permission: "write", role_name: "write" } };
          if (username === "admin") return { data: { permission: "admin", role_name: "admin" } };
          if (username === "author") return { data: { permission: "read", role_name: "read" } };
          return { data: { permission: "read", role_name: "read" } };
        }),
      },
      orgs: {
        getMembershipForUser: jest.fn(({ username }: { username: string }) => {
          if (username === "collab") return Promise.resolve({ data: { state: "active", role: "member" } });
          if (username === "admin") return Promise.resolve({ data: { state: "active", role: "admin" } });
          throw new Error("not a member");
        }),
      },
    },
    paginate: jest.fn((fn: unknown) => {
      // Resolve to different arrays based on the API method reference
      if (fn === octokit.rest.issues.listEvents) return Promise.resolve(events);
      if (fn === octokit.rest.issues.listLabelsForRepo)
        return Promise.resolve([{ name: "Time: 15 Minutes" }, { name: "Time: 2 Hours" }, { name: "Time: 1 Week" }]);
      return Promise.resolve([]);
    }),
  };

  return {
    logger,
    payload: {
      action: "created",
      repository: { owner: { login: "owner" }, name: "repo" },
      organization: org ? { login: org } : undefined,
      sender: { login: sender },
      issue,
      comment: {
        author_association: "NONE",
        body: "/time 2h",
        html_url: "",
        id: 1,
        node_id: "",
        user: { ...mockUser, login: sender },
        created_at: "",
        updated_at: "",
        url: "",
        reactions: mockReactions,
        issue_url: "",
        performed_via_github_app: null,
      },
    },
    octokit,
  } as unknown as Context<"issue_comment.created">;
}

describe("time label permissions hierarchy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("allows anybody to set time when unset", async () => {
    const ctx = makeContext({ sender: "outsider", authorLogin: "author", issueLabels: [], events: [] });
    await setTimeLabel(ctx as unknown as Context<"issue_comment.created">, "2h");
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(expect.anything(), "Time: 2 Hours");
  });

  it("allows author to override time set by anybody", async () => {
    const ctx = makeContext({
      sender: "author",
      authorLogin: "author",
      issueLabels: ["Time: 1 Hour"],
      events: [
        { event: "labeled", label: { name: "Time: 1 Hour" }, actor: { login: "outsider" } },
        { event: "labeled", label: { name: "bug" } },
      ],
    });
    await setTimeLabel(ctx as unknown as Context<"issue_comment.created">, "2h");
    expect(mockRemoveLabelFromIssue).toHaveBeenCalled();
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(expect.anything(), "Time: 2 Hours");
  });

  it("allows author to override time set by collaborator", async () => {
    const ctx = makeContext({
      sender: "author",
      authorLogin: "author",
      issueLabels: ["Time: 1 Hour"],
      events: [{ event: "labeled", label: { name: "Time: 1 Hour" }, actor: { login: "collab" } }],
    });
    await setTimeLabel(ctx as unknown as Context<"issue_comment.created">, "2h");
    expect(mockRemoveLabelFromIssue).toHaveBeenCalled();
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(expect.anything(), "Time: 2 Hours");
  });

  it("allows author to override time set by bot", async () => {
    const ctx = makeContext({
      sender: "author",
      authorLogin: "author",
      issueLabels: ["Time: 1 Hour"],
      events: [
        { event: "labeled", label: { name: "Time: 1 Hour" }, actor: { login: "pricing-bot", type: "Bot" } as unknown as { login: string; type: string } },
      ] as unknown as Array<{ event: string; label?: { name: string }; actor?: { login: string; type: string } }>,
    });
    await setTimeLabel(ctx as unknown as Context<"issue_comment.created">, "2h");
    expect(mockRemoveLabelFromIssue).toHaveBeenCalled();
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(expect.anything(), "Time: 2 Hours");
  });

  it("allows collaborator to change existing time", async () => {
    const ctx = makeContext({
      sender: "collab",
      authorLogin: "author",
      issueLabels: ["Time: 1 Hour"],
      events: [{ event: "labeled", label: { name: "Time: 1 Hour" }, actor: { login: "author" } }],
      org: "some-org",
    });
    await setTimeLabel(ctx as unknown as Context<"issue_comment.created">, "2h");
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(expect.anything(), "Time: 2 Hours");
  });

  it("allows contributor to change existing time", async () => {
    const ctx = makeContext({
      sender: "outsider",
      authorLogin: "author",
      issueLabels: ["Time: 1 Hour"],
      events: [{ event: "labeled", label: { name: "Time: 1 Hour" }, actor: { login: "author" } }],
    });
    await setTimeLabel(ctx as unknown as Context<"issue_comment.created">, "2h");
    expect(mockRemoveLabelFromIssue).toHaveBeenCalled();
    expect(mockAddLabelToIssue).toHaveBeenCalledWith(expect.anything(), "Time: 2 Hours");
  });
});
