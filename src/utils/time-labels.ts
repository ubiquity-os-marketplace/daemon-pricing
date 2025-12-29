import ms from "ms";

export type TimeUnit = "minute" | "hour" | "day" | "week" | "month";

export type ParsedTime = {
  value: number;
  unit: TimeUnit;
};

const UNIT_ALIASES: Record<string, TimeUnit> = {
  m: "minute",
  min: "minute",
  mins: "minute",
  minute: "minute",
  minutes: "minute",
  h: "hour",
  hr: "hour",
  hrs: "hour",
  hour: "hour",
  hours: "hour",
  d: "day",
  day: "day",
  days: "day",
  w: "week",
  wk: "week",
  wks: "week",
  week: "week",
  weeks: "week",
  mo: "month",
  mon: "month",
  mons: "month",
  month: "month",
  months: "month",
};

const UNIT_LABELS: Record<TimeUnit, { singular: string; plural: string }> = {
  minute: { singular: "Minute", plural: "Minutes" },
  hour: { singular: "Hour", plural: "Hours" },
  day: { singular: "Day", plural: "Days" },
  week: { singular: "Week", plural: "Weeks" },
  month: { singular: "Month", plural: "Months" },
};

function stripTimePrefix(input: string): string {
  const match = RegExp(/^Time:\s*<?\s*(.+)$/i).exec(input.trim());
  return match ? match[1].trim() : input.trim();
}

function normalizeUnit(rawUnit: string): TimeUnit | null {
  const key = rawUnit.toLowerCase();
  return UNIT_ALIASES[key] ?? null;
}

function extractNumberAndUnit(input: string): ParsedTime | null {
  const match = /(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\b/.exec(input);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = normalizeUnit(match[2]);
  if (!unit) return null;
  return { value, unit };
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return value.toString();
  return Number(value.toFixed(2)).toString();
}

export function parseTimeInput(input: string): ParsedTime | null {
  if (!input) return null;
  let trimmed = stripTimePrefix(input);
  trimmed = trimmed.replace(/^</, "").trim();
  if (!trimmed) return null;

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return { value: Number.parseFloat(trimmed), unit: "day" };
  }

  const direct = extractNumberAndUnit(trimmed);
  if (direct) return direct;

  const msValue = ms(trimmed);
  if (typeof msValue === "number" && msValue > 0) {
    const longForm = ms(msValue, { long: true });
    if (typeof longForm === "string") {
      return extractNumberAndUnit(longForm);
    }
  }

  return null;
}

export function parseTimeLabel(label: string): ParsedTime | null {
  if (!/^Time:/i.test(label.trim())) return null;
  return parseTimeInput(label);
}

export function isTimeLabel(label: string): boolean {
  return parseTimeLabel(label) !== null;
}

export function formatDuration(parsed: ParsedTime): string {
  const unitLabel = parsed.value === 1 ? UNIT_LABELS[parsed.unit].singular : UNIT_LABELS[parsed.unit].plural;
  return `${formatNumber(parsed.value)} ${unitLabel}`;
}

export function formatTimeLabel(parsed: ParsedTime): string {
  return `Time: ${formatDuration(parsed)}`;
}
