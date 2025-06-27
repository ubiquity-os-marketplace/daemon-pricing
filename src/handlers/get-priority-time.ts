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
  return new Decimal(base).mul(1000).mul(time).mul(priorityValue).toDecimalPlaces(2);
}

export function convertHoursLabel(timeEstimate: string): string {
  const hours = Number(timeEstimate);
  if (isNaN(hours)) throw new Error("Invalid time estimate");
  if (hours < 1) {
    const minutes = +(hours * 60).toFixed(2);
    return `Time: ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  if (hours < 24) {
    const roundedHours = +hours.toFixed(2);
    return `Time: ${roundedHours} hour${roundedHours === 1 ? "" : "s"}`;
  }
  if (hours < 168) {
    const days = +(hours / 24).toFixed(2);
    return `Time: ${days} day${days === 1 ? "" : "s"}`;
  }
  if (hours < 730) {
    const weeks = +(hours / 168).toFixed(2);
    return `Time: ${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  const months = +(hours / 730).toFixed(2);
  return `Time: ${months} month${months === 1 ? "" : "s"}`;
}
