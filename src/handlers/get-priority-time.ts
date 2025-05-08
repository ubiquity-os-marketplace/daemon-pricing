import { Decimal } from "decimal.js";

export interface PriorityTimeEstimate {
  time: string;
  priority: string;
}

export interface PriorityTimeResponse {
  estimated_time: string;
  priority: string;
}

export async function getPriorityTime(
  issueDescription: string,
  issueTitle: string,
  basetenApiKey: string,
  basetenApiUrl: string
): Promise<PriorityTimeEstimate> {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Api-Key ${basetenApiKey}`,
  };
  const body = JSON.stringify({
    title: issueTitle,
    description: issueDescription,
  });
  const response = await fetch(basetenApiUrl, {
    method: "POST",
    headers: headers,
    body: body,
  });
  if (!response.ok) {
    throw new Error(`Error: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as PriorityTimeResponse;
  if (!data) {
    throw new Error("No data returned from Baseten API");
  }
  const time = data.estimated_time;
  const priority = data.priority;
  if (!time || !priority) {
    throw new Error("No time or priority returned from Baseten API");
  }
  return {
    time: time,
    priority: priority,
  };
}

export function getPricing(base: number, time: number, priorityLabel: string): Decimal {
  const priority = RegExp(/\d+/).exec(priorityLabel)?.[0];
  if (!priority) {
    throw new Error("No priority value found");
  }
  const priorityValue = new Decimal(priority).div(10);
  return new Decimal(base)
    .mul(1000)
    .mul(time * 0.125)
    .mul(priorityValue)
    .toDecimalPlaces(2);
}
