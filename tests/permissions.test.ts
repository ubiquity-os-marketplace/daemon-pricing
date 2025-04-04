import { describe, expect, it, jest } from "@jest/globals";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import { Context } from "../src/types/context";

describe("Permission tests for labels", () => {
  beforeAll(async () => {
    jest.resetAllMocks();
    jest.resetModules();
  });

  it("Should properly deny or accept a user according to its privileges", async () => {
    const isUserAdminOrBillingManagerMock = jest.fn();
    const postCommentMock = jest.fn();
    isUserAdminOrBillingManagerMock.mockImplementation(() => Promise.resolve({ data: { permission: "admin" } }));
    jest.unstable_mockModule("../src/shared/issue", () => ({
      isUserAdminOrBillingManager: isUserAdminOrBillingManagerMock,
    }));
    const { labelAccessPermissionsCheck } = await import("../src/shared/permissions");
    const checkMembershipForUser = jest.fn();
    const ctx = {
      logger: new Logs("debug"),
      eventName: "issues.labeled",
      payload: {
        label: {
          name: "documentation",
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
      },
      config: {
        shouldFundContributorClosedIssue: false,
        labels: {
          priority: [{ name: "Priority: 1 (Normal)" }, { name: "Priority: 2 (Medium)" }],
          time: [{ name: "Time: <1 day" }, { name: "Time: <1 Week" }],
        },
      },
      commentHandler: {
        postComment: postCommentMock,
      },
      octokit: {
        rest: {
          issues: {
            updateLabel: jest.fn(),
          },
          repos: {
            getCollaboratorPermissionLevel: isUserAdminOrBillingManagerMock,
          },
          orgs: {
            checkMembershipForUser: checkMembershipForUser,
            getMembershipForUser: jest.fn(() => ({ data: { membership: "none" } })),
          },
        },
        paginate: jest.fn(),
      },
    };
    // should ignore non-standard labels
    let isAllowed = await labelAccessPermissionsCheck(ctx as unknown as Context);
    expect(isAllowed).toEqual(false);

    ctx.payload.label.name = "Price: 1000 USD";

    isUserAdminOrBillingManagerMock.mockImplementation(() => Promise.resolve({ data: { permission: "admin" } }));
    // should give access to admins
    isAllowed = await labelAccessPermissionsCheck(ctx as unknown as Context);
    expect(isAllowed).toEqual(true);

    isUserAdminOrBillingManagerMock.mockImplementation(() => Promise.resolve(false));
    checkMembershipForUser.mockImplementation(() => {
      throw new Error();
    });
    // should deny non-admin users
    isAllowed = await labelAccessPermissionsCheck(ctx as unknown as Context);
    expect(isAllowed).toEqual(false);

    ctx.payload.label.name = "Custom: 2 REWARDS";

    isUserAdminOrBillingManagerMock.mockImplementation(() => Promise.resolve({ data: { permission: "read" } }));
    checkMembershipForUser.mockImplementation(jest.fn());
    // should allow unprotected labels for non-admins
    ctx.config.shouldFundContributorClosedIssue = true;
    isAllowed = await labelAccessPermissionsCheck(ctx as unknown as Context);
    expect(isAllowed).toEqual(true);
  });
});
