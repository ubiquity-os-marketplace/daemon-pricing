import { jest } from "@jest/globals";
import { LogReturn, Logs } from "@ubiquity-os/ubiquity-os-logger";
import { determinePriorityOrder, extractLabelPattern } from "../src/handlers/label-checks";
import { calculateLabelValue } from "../src/shared/pricing";
import { Context } from "../src/types/context";

interface Label {
  id: number;
  node_id: string;
  url: string;
  name: string;
  description: string | null;
  color: string;
  default: boolean;
}

const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  ok: jest.fn(),
};

const mockOctokit = {
  rest: {
    issues: {
      updateLabel: jest.fn(),
    },
  },
  paginate: jest.fn(),
};

const mockContext: Context = {
  config: {
    labels: {
      priority: [],
    },
    basePriceMultiplier: 1,
    globalConfigUpdate: { excludeRepos: [] },
  },
  logger: mockLogger,
  payload: {
    repository: {
      owner: { login: "owner" },
      name: "repo",
    },
  },
  octokit: mockOctokit,
} as unknown as Context;

describe("syncPriceLabelsToConfig function", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it("updates price label colors when incorrect", async () => {
    const allLabels: Label[] = [
      { id: 1, node_id: "n1", url: "", name: "Priority: 1 (Normal)", description: "", color: "ededed", default: false },
      { id: 2, node_id: "n2", url: "", name: "Priority: 2 (Medium)", description: "", color: "ededed", default: false },
      { id: 3, node_id: "n3", url: "", name: "Price: 10 USD", description: "", color: "000000", default: false },
    ];
    jest.mock("../src/shared/label", () => ({
      COLORS: { price: "1f883d" },
      listLabelsForRepo: async () => allLabels,
      createLabel: async () => undefined,
    }));
    const { syncPriceLabelsToConfig } = await import("../src/handlers/sync-labels-to-config");

    mockContext.config.labels.priority = [
      { name: "Priority: 1 (Normal)", collaboratorOnly: false },
      { name: "Priority: 2 (Medium)", collaboratorOnly: false },
    ];

    await syncPriceLabelsToConfig(mockContext);

    expect(mockOctokit.rest.issues.updateLabel).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Price: 10 USD",
        color: "1f883d",
      })
    );
  }, 15000);

  it("creates missing priority labels", async () => {
    const allLabels: Label[] = [];
    const createLabelSpy = jest.fn<(context: Context, name: string, color: string) => Promise<void>>().mockResolvedValue(undefined);
    jest.mock("../src/shared/label", () => ({
      COLORS: { price: "1f883d" },
      listLabelsForRepo: async () => allLabels,
      createLabel: createLabelSpy,
    }));
    const { syncPriceLabelsToConfig } = await import("../src/handlers/sync-labels-to-config");

    mockContext.config.labels.priority = [
      { name: "Priority: 1 (Normal)", collaboratorOnly: false },
      { name: "Priority: 2 (Medium)", collaboratorOnly: false },
    ];

    await syncPriceLabelsToConfig(mockContext);

    expect(createLabelSpy).toHaveBeenCalledTimes(2);
    expect(createLabelSpy).toHaveBeenCalledWith(expect.anything(), "Priority: 1 (Normal)", "default");
    expect(createLabelSpy).toHaveBeenCalledWith(expect.anything(), "Priority: 2 (Medium)", "default");
  }, 15000);

  it("Should properly handle 0 priority label", () => {
    const ctx = {
      config: {
        labels: {
          priority: [{ name: "Priority: 0 (Regression)" }],
        },
      },
    } as unknown as Context;
    let labelValue = calculateLabelValue(ctx, "Priority: 0 (Regression)");
    expect(labelValue).toEqual(0);
    labelValue = calculateLabelValue(ctx, "Priority: - (Regression)");
    expect(labelValue).toEqual(null);
    labelValue = calculateLabelValue(ctx, "Time: 0 Hours");
    expect(labelValue).toEqual(0);
    labelValue = calculateLabelValue(ctx, "Time: some Hours");
    expect(labelValue).toEqual(null);
  });

  it("Should ignore tags on parent issue, and clear pricing", async () => {
    const clearAllPriceLabelsOnIssue = jest.fn();
    const context = { logger: new Logs("debug"), eventName: "issues.labeled" } as unknown as Context;
    jest.mock("../src/shared/label", () => ({
      clearAllPriceLabelsOnIssue: clearAllPriceLabelsOnIssue,
    }));
    const { handleParentIssue } = await import("../src/handlers/handle-parent-issue");

    await expect(handleParentIssue(context, [])).rejects.toBeInstanceOf(LogReturn);
    await expect(
      handleParentIssue(context, [
        {
          name: "Price: 1 USD",
          id: 0,
          node_id: "",
          url: "",
          description: null,
          color: "",
          default: false,
        },
      ])
    ).rejects.toBeInstanceOf(LogReturn);
    expect(clearAllPriceLabelsOnIssue).toHaveBeenCalledTimes(1);
  });

  it("Should handle unconventional label names", () => {
    const labelList1 = [
      { name: "P0", collaboratorOnly: false },
      { name: "P1", collaboratorOnly: false },
    ];
    const labelList2 = [
      { name: "Priority: 1 (Normal)", collaboratorOnly: false },
      { name: "Priority: 2 (Medium)", collaboratorOnly: false },
    ];
    const labelList3 = [
      { name: "p2", collaboratorOnly: false },
      { name: "p1", collaboratorOnly: false },
      { name: "p0", collaboratorOnly: false },
    ];
    const invalidLabelList = [
      { name: "Prio: 1", collaboratorOnly: false },
      { name: "p2", collaboratorOnly: false },
      { name: "p high", collaboratorOnly: false },
    ];

    expect(extractLabelPattern(labelList1)).toEqual(/P(\d*\.?\d+)/i);
    expect(extractLabelPattern(labelList2)).toEqual(/Priority: (\d*\.?\d+)/i);
    expect(extractLabelPattern(labelList3)).toEqual(/p(\d*\.?\d+)/i);
    expect(() => extractLabelPattern(invalidLabelList)).toThrow();

    expect(determinePriorityOrder(labelList1)).toEqual(1);
    expect(determinePriorityOrder(labelList2)).toEqual(1);
    expect(determinePriorityOrder(labelList3)).toEqual(-1);
    expect(() => determinePriorityOrder(invalidLabelList)).toThrow();
  });
});
