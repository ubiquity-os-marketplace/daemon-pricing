import { describe, expect, it, jest } from "@jest/globals";
import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import { Context } from "../src/types/context";

describe("Permission tests for labels", () => {
  it("Should properly deny or accept a user according to its privileges", async () => {
    const isUserAdminOrBillingManagerMock = jest.fn();
    const postCommentMock = jest.fn();
    isUserAdminOrBillingManagerMock.mockImplementation(() => Promise.resolve("admin"));
    jest.unstable_mockModule("../src/shared/issue", () => ({
      isUserAdminOrBillingManager: isUserAdminOrBillingManagerMock,
    }));
    jest.unstable_mockModule("@ubiquity-os/plugin-sdk", () => ({
      postComment: postCommentMock,
    }));
    const { labelAccessPermissionsCheck } = await import("../src/shared/permissions");
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
        },
        action: "labeled",
      },
      config: {
        publicAccessControl: {
          protectLabels: ["Price"],
        },
      },
    };
    // should ignore non-standard labels
    let isAllowed = await labelAccessPermissionsCheck(ctx as unknown as Context);
    expect(isAllowed).toEqual(false);

    ctx.payload.label.name = "Price: 1000 USD";

    isUserAdminOrBillingManagerMock.mockImplementation(() => Promise.resolve("admin"));
    // should give access to admins
    isAllowed = await labelAccessPermissionsCheck(ctx as unknown as Context);
    expect(isAllowed).toEqual(true);

    isUserAdminOrBillingManagerMock.mockImplementation(() => Promise.resolve(false));
    // should deny non-admin users
    isAllowed = await labelAccessPermissionsCheck(ctx as unknown as Context);
    expect(isAllowed).toEqual(false);
    expect(postCommentMock).toHaveBeenCalledTimes(1);

    ctx.payload.label.name = "Custom: 2 REWARDS";

    isUserAdminOrBillingManagerMock.mockImplementation(() => Promise.resolve(false));
    // should allow unprotected labels for non-admins
    isAllowed = await labelAccessPermissionsCheck(ctx as unknown as Context);
    expect(isAllowed).toEqual(true);
  });
});
