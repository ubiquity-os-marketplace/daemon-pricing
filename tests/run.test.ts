import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Context } from "../src/types/context";

const mockTime = jest.fn(async () => undefined);
const mockEnsureTimeLabelOnIssueOpened = jest.fn(async () => undefined);
const mockDispatchDeepEstimate = jest.fn(async () => undefined);
const mockSyncPriceLabelsToConfig = jest.fn(async () => undefined);
const mockOnIssueOpenedUpdatePricing = jest.fn(async () => undefined);
const mockOnLabelChangeSetPricing = jest.fn(async () => undefined);
const mockGlobalLabelUpdate = jest.fn(async () => undefined);

jest.mock("../src/utils/time", () => ({
  ensureTimeLabelOnIssueOpened: mockEnsureTimeLabelOnIssueOpened,
  time: mockTime,
}));

jest.mock("../src/utils/deep-estimate-dispatch", () => ({
  dispatchDeepEstimate: mockDispatchDeepEstimate,
}));

jest.mock("../src/handlers/sync-labels-to-config", () => ({
  syncPriceLabelsToConfig: mockSyncPriceLabelsToConfig,
}));

jest.mock("../src/handlers/pricing-label", () => ({
  onIssueOpenedUpdatePricing: mockOnIssueOpenedUpdatePricing,
  onLabelChangeSetPricing: mockOnLabelChangeSetPricing,
}));

jest.mock("../src/handlers/global-config-update", () => ({
  globalLabelUpdate: mockGlobalLabelUpdate,
}));

let run: typeof import("../src/run").run;

beforeAll(async () => {
  ({ run } = await import("../src/run"));
});

function makeIssueCommentContext({
  sender = "outsider",
  issueAuthor = "author",
  body = "/time 2h",
  repoPermission = "read",
  orgLogin,
  isOrgMember = false,
  orgRole = "member",
  command,
}: {
  sender?: string;
  issueAuthor?: string;
  body?: string;
  repoPermission?: string;
  orgLogin?: string;
  isOrgMember?: boolean;
  orgRole?: string;
  command?: Context["command"];
} = {}) {
  const createComment = jest.fn(async () => ({ data: { id: 1 } }));
  const getCollaboratorPermissionLevel = jest.fn(async () => ({
    data: {
      permission: repoPermission,
      role_name: repoPermission,
    },
  }));
  const checkMembershipForUser = jest.fn(async () => {
    if (!isOrgMember) {
      throw new Error("not a member");
    }
    return { status: 204 };
  });
  const getMembershipForUser = jest.fn(async () => ({
    data: {
      role: orgRole,
      state: "active",
    },
  }));

  const context = {
    eventName: "issue_comment.created",
    logger: {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      ok: jest.fn(),
      fatal: jest.fn(),
    },
    payload: {
      action: "created",
      organization: orgLogin ? { login: orgLogin } : undefined,
      repository: {
        owner: { login: "owner" },
        name: "repo",
      },
      sender: {
        login: sender,
        type: "User",
      },
      issue: {
        number: 42,
        user: {
          login: issueAuthor,
        },
      },
      comment: {
        id: 7,
        body,
        user: {
          login: sender,
        },
      },
    },
    command,
    octokit: {
      rest: {
        issues: {
          createComment,
        },
        repos: {
          getCollaboratorPermissionLevel,
        },
        orgs: {
          checkMembershipForUser,
          getMembershipForUser,
        },
      },
    },
  } as unknown as Context<"issue_comment.created">;

  return {
    context,
    createComment,
    getCollaboratorPermissionLevel,
    checkMembershipForUser,
    getMembershipForUser,
  };
}

describe("run /time authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GITHUB_ACTIONS;
  });

  it("posts a warning and skips /time for unauthorized issue comments", async () => {
    const { context, createComment } = makeIssueCommentContext();

    await run(context);

    expect(createComment).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 42,
      body: "@outsider you do not have permissions to run the `/time` command.",
    });
    expect(mockTime).not.toHaveBeenCalled();
    expect(mockDispatchDeepEstimate).not.toHaveBeenCalled();
  });

  it("posts a warning and skips parsed /time commands for unauthorized users", async () => {
    const { context, createComment } = makeIssueCommentContext({
      command: {
        name: "time",
        parameters: {
          duration: "2h",
        },
      },
    });

    await run(context);

    expect(createComment).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 42,
      body: "@outsider you do not have permissions to run the `/time` command.",
    });
    expect(mockTime).not.toHaveBeenCalled();
    expect(mockDispatchDeepEstimate).not.toHaveBeenCalled();
  });

  it("allows the issue author to run /time", async () => {
    const { context, createComment, getCollaboratorPermissionLevel, checkMembershipForUser } = makeIssueCommentContext({
      sender: "author",
      issueAuthor: "author",
    });

    await run(context);

    expect(createComment).not.toHaveBeenCalled();
    expect(getCollaboratorPermissionLevel).not.toHaveBeenCalled();
    expect(checkMembershipForUser).not.toHaveBeenCalled();
    expect(mockTime).toHaveBeenCalledWith(context);
    expect(mockDispatchDeepEstimate).toHaveBeenCalledTimes(1);
  });

  it("allows an organization member to run /time", async () => {
    const { context, createComment, getCollaboratorPermissionLevel, checkMembershipForUser, getMembershipForUser } = makeIssueCommentContext({
      sender: "member",
      orgLogin: "ubiquity-os-marketplace",
      isOrgMember: true,
    });

    await run(context);

    expect(createComment).not.toHaveBeenCalled();
    expect(checkMembershipForUser).toHaveBeenCalledWith({
      org: "ubiquity-os-marketplace",
      username: "member",
    });
    expect(getMembershipForUser).toHaveBeenCalledWith({
      org: "ubiquity-os-marketplace",
      username: "member",
    });
    expect(getCollaboratorPermissionLevel).not.toHaveBeenCalled();
    expect(mockTime).toHaveBeenCalledWith(context);
    expect(mockDispatchDeepEstimate).toHaveBeenCalledTimes(1);
  });

  it("allows a billing manager to run /time", async () => {
    const { context, createComment, getMembershipForUser } = makeIssueCommentContext({
      sender: "billing",
      orgLogin: "ubiquity-os-marketplace",
      isOrgMember: true,
      orgRole: "billing_manager",
    });

    await run(context);

    expect(createComment).not.toHaveBeenCalled();
    expect(getMembershipForUser).toHaveBeenCalledWith({
      org: "ubiquity-os-marketplace",
      username: "billing",
    });
    expect(mockTime).toHaveBeenCalledWith(context);
    expect(mockDispatchDeepEstimate).toHaveBeenCalledTimes(1);
  });

  it("allows collaborators with write access to run /time", async () => {
    const { context, createComment, getCollaboratorPermissionLevel } = makeIssueCommentContext({
      sender: "collaborator",
      repoPermission: "write",
    });

    await run(context);

    expect(createComment).not.toHaveBeenCalled();
    expect(getCollaboratorPermissionLevel).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      username: "collaborator",
    });
    expect(mockTime).toHaveBeenCalledWith(context);
    expect(mockDispatchDeepEstimate).toHaveBeenCalledTimes(1);
  });

  it("ignores non-/time issue comments", async () => {
    const { context, createComment, getCollaboratorPermissionLevel, checkMembershipForUser } = makeIssueCommentContext({
      body: "hello there",
    });

    await run(context);

    expect(createComment).not.toHaveBeenCalled();
    expect(getCollaboratorPermissionLevel).not.toHaveBeenCalled();
    expect(checkMembershipForUser).not.toHaveBeenCalled();
    expect(mockTime).not.toHaveBeenCalled();
    expect(mockDispatchDeepEstimate).not.toHaveBeenCalled();
  });
});
