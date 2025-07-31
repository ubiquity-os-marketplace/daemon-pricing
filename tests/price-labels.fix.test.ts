import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import { Context } from "../src/types/context";
import { Label } from "../src/types/github";

describe("Pricing labels", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function makeContext(overrides: Partial<Context> = {}): Context {
    const logger = new Logs("debug");
    const base: Partial<Context> = {
      config: {
        labels: {
          time: [{ name: "Time: 1 Hour" }, { name: "Time: 2 Hours" }],
          priority: [
            { name: "Priority: 1 (Normal)", collaboratorOnly: false },
            { name: "Priority: 2 (Medium)", collaboratorOnly: false },
          ],
        },
        basePriceMultiplier: 1,
        globalConfigUpdate: { excludeRepos: [] },
        shouldFundContributorClosedIssue: false,
      },
      logger,
      payload: {
        repository: {
          owner: { login: "owner" },
          name: "repo",
          html_url: "https://github.com/owner/repo",
        },
        issue: {
          number: 1,
          body: "Test body",
          labels: [],
        },
        sender: { type: "User" },
        label: { name: "" },
      } as unknown as Context["payload"],
      eventName: "issues.labeled",
      commentHandler: {
        // _lastCommentId: null,
        // _updateIssueComment: jest.fn(),
        // _updateReviewComment: jest.fn(),
        // _createNewComment: jest.fn(),
        // _createNewReviewComment: jest.fn(),
        // _createReaction: jest.fn(),
        // _deleteComment: jest.fn(),
        // _deleteReaction: jest.fn(),
        // _getComments: jest.fn(),
        // _getReviewComments: jest.fn(),
        // _getReactions: jest.fn(),
        postComment: jest.fn(async () => null),
      } as unknown as Context["commentHandler"],
      octokit: {
        rest: {
          issues: {
            removeLabel: jest.fn(async () => undefined),
            listEvents: jest.fn(),
          },
        },
        paginate: jest.fn(async () => []),
      } as unknown as Context["octokit"],
    };
    return { ...(base as Context), ...(overrides as Context) };
  }

  it("Should call removeUnauthorizedLabel when the user is not allowed to change labels", async () => {
    const removeLabelHttp = jest.fn(async () => undefined);
    const postComment = jest.fn(async () => null);

    jest.unstable_mockModule("../src/shared/permissions", () => {
      return {
        labelAccessPermissionsCheck: jest.fn(async () => false),
        getCollaboratorPermissionLevel: jest.fn(async () => "read"),
        isMemberOfOrg: jest.fn(async () => false),
      };
    });
    jest.unstable_mockModule("../src/shared/issue", () => {
      return {
        checkIfIsAdmin: jest.fn(async () => false),
        isUserAdminOrBillingManager: jest.fn(async () => false),
        checkIfIsBillingManager: jest.fn(async () => false),
      };
    });
    jest.unstable_mockModule("../src/types/typeguards", () => ({
      isIssueLabelEvent: function isIssueLabelEvent() {
        return true;
      },
    }));
    jest.unstable_mockModule("../src/handlers/handle-parent-issue", () => ({
      isParentIssue: function isParentIssue() {
        return false;
      },
      handleParentIssue: jest.fn(),
      sortLabelsByValue: function sortLabelsByValue(unused: unknown, labels: Label[]) {
        return labels;
      },
    }));

    const { onLabelChangeSetPricing: run } = await import("../src/handlers/pricing-label");

    const context = makeContext({
      eventName: "issues.labeled",
      payload: {
        repository: { owner: { login: "owner" }, name: "repo", html_url: "https://github.com/owner/repo" },
        organization: { login: "some-org" } as unknown as Context["payload"]["organization"],
        issue: { number: 11, body: "Body", labels: [{ name: "Priority: 1 (Normal)" } as Label] },
        label: { name: "Priority: 1 (Normal)" },
        sender: { type: "User", login: "someone" },
      } as unknown as Context["payload"],
      commentHandler: { postComment } as unknown as Context["commentHandler"],
      octokit: {
        rest: {
          issues: {
            removeLabel: removeLabelHttp,
          },
          repos: {
            getCollaboratorPermissionLevel: jest.fn(async () => ({
              data: { permission: "read" },
            })),
          },
          orgs: {
            getMembershipForUser: jest.fn(async () => ({
              data: { role: "member" },
            })),
          },
        },
      } as unknown as Context["octokit"],
    });

    await run(context);

    expect(postComment).toHaveBeenCalled();
    expect(removeLabelHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "owner",
        repo: "repo",
        issue_number: 11,
        name: "Priority: 1 (Normal)",
      })
    );
  });
});
