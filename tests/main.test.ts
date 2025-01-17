import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { drop } from "@mswjs/data";
import { Value } from "@sinclair/typebox/value";
import * as crypto from "node:crypto";
import { calculateLabelValue, calculateTaskPrice } from "../src/shared/pricing";
import { Context } from "../src/types/context";
import { Env } from "../src/types/env";
import { AssistivePricingSettings, pluginSettingsSchema } from "../src/types/plugin-input";
import workerFetch from "../src/worker";
import { db } from "./__mocks__/db";
import { server } from "./__mocks__/node";
import issueCommented from "./__mocks__/requests/issue-comment-post.json";
import usersGet from "./__mocks__/users-get.json";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: "spki",
    format: "pem",
  },
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem",
  },
});

const url = "/";

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("User tests", () => {
  beforeEach(() => {
    drop(db);
    for (const item of usersGet) {
      db.users.create(item);
    }
  });

  it("Should not include globalConfigUpdate in defaults if omitted", () => {
    const settings = Value.Default(pluginSettingsSchema, {}) as AssistivePricingSettings;
    const decodedSettings = Value.Decode(pluginSettingsSchema, settings);
    expect(decodedSettings.globalConfigUpdate).toBeUndefined();
  });

  it("Should accurately calculates prices", () => {
    const context = {
      config: {
        basePriceMultiplier: 3.0,
      },
    };
    const priority1 = "1 priority";
    const priority2 = "2 priority";
    const priority3 = "3 priority";
    const testCases = [
      {
        timeValue: calculateLabelValue("<1 minutes"),
        priorityValue: calculateLabelValue(priority3),
        expectedPrice: "1.8",
      },
      {
        timeValue: calculateLabelValue("<4 hours"),
        priorityValue: calculateLabelValue(priority2),
        expectedPrice: "300",
      },
      {
        timeValue: calculateLabelValue("<1 hours"),
        priorityValue: calculateLabelValue(priority2),
        expectedPrice: "75",
      },
      {
        timeValue: calculateLabelValue("<1.52 hours"),
        priorityValue: calculateLabelValue(priority3),
        expectedPrice: "112.5",
      },
      {
        timeValue: calculateLabelValue("<139.876 minutes"),
        priorityValue: calculateLabelValue(priority1),
        expectedPrice: "83.4",
      },
      {
        timeValue: calculateLabelValue("<12.333333 weeks"),
        priorityValue: calculateLabelValue(priority2),
        expectedPrice: "7800",
      },
    ];
    for (const testCase of testCases) {
      const price = calculateTaskPrice(context as unknown as Context, testCase.timeValue as number, testCase.priorityValue as number);
      expect(price).toEqual(testCase.expectedPrice);
    }
  });

  it("Should deny non POST request", async () => {
    const result = await workerFetch.fetch(
      {
        method: "GET",
        url,
        clone: jest.fn(),
      } as unknown as Request,
      {
        KERNEL_PUBLIC_KEY: "key",
      }
    );
    expect(result.ok).toEqual(false);
    expect(result.status).toEqual(404);
  });

  it("Should reject an invalid environment", async () => {
    const data = issueCommented;
    const sign = crypto.createSign("SHA256");
    sign.update(JSON.stringify(data));
    sign.end();
    const signature = sign.sign(privateKey, "base64");

    process.env = {
      LOG_LEVEL: "1234",
    };

    const result = await workerFetch.fetch(
      {
        method: "POST",
        headers: {
          get: () => "application/json",
        },
        url,
        json: () => ({
          ...data,
          signature,
        }),
        clone: jest.fn(),
      } as unknown as Request,
      {
        KERNEL_PUBLIC_KEY: publicKey,
      } as Env
    );
    expect(result.ok).toEqual(false);
    expect(result.status).toEqual(500);
    expect(await result.text()).toEqual("Internal Server Error");
  });
});
