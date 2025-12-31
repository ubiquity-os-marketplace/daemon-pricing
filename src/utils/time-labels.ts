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

const UNIT_TO_MINUTES: Record<TimeUnit, number> = {
  minute: 1,
  hour: 60,
  day: 60 * 24,
  week: 60 * 24 * 7,
  month: 60 * 24 * 30,
};

const UNIT_RANK: Record<TimeUnit, number> = {
  minute: 0,
  hour: 1,
  day: 2,
  week: 3,
  month: 4,
};

const DURATION_PART_REGEX = /(\d+(?:\.\d+)?)\s*([a-zA-Z]+)/g;

function formatUnitLabel(unit: TimeUnit, value: number): string {
  const base = unit.charAt(0).toUpperCase() + unit.slice(1);
  return value === 1 ? base : `${base}s`;
}

function stripTimePrefix(input: string): string {
  const match = RegExp(/^Time:\s*<?\s*(.+)$/i).exec(input.trim());
  return match ? match[1].trim() : input.trim();
}

function normalizeUnit(rawUnit: string): TimeUnit | null {
  const key = rawUnit.toLowerCase();
  return UNIT_ALIASES[key] ?? null;
}

function parseDurationParts(input: string): ParsedTime[] | null {
  const matches = [...input.matchAll(DURATION_PART_REGEX)];
  if (matches.length === 0) return null;

  const parts: ParsedTime[] = [];
  for (const match of matches) {
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value)) return null;
    const unit = normalizeUnit(match[2]);
    if (!unit) return null;
    parts.push({ value, unit });
  }

  const remainder = input
    .replace(DURATION_PART_REGEX, " ")
    .replace(/\band\b/gi, " ")
    .replace(/[,]+/g, " ")
    .trim();
  if (remainder) return null;

  return parts;
}

function collapseParsedParts(parts: ParsedTime[]): ParsedTime | null {
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];

  const totalMinutes = parts.reduce((sum, part) => sum + part.value * UNIT_TO_MINUTES[part.unit], 0);
  if (!Number.isFinite(totalMinutes)) return null;

  const targetUnit = parts.reduce((best, part) => (UNIT_RANK[part.unit] > UNIT_RANK[best] ? part.unit : best), parts[0].unit);
  return { value: totalMinutes / UNIT_TO_MINUTES[targetUnit], unit: targetUnit };
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

  const parts = parseDurationParts(trimmed);
  const collapsed = parts ? collapseParsedParts(parts) : null;
  if (collapsed) return collapsed;

  const msValue = ms(trimmed);
  if (typeof msValue === "number" && msValue > 0) {
    const longForm = ms(msValue, { long: true });
    if (typeof longForm === "string") {
      const msParts = parseDurationParts(longForm);
      const msCollapsed = msParts ? collapseParsedParts(msParts) : null;
      if (msCollapsed) return msCollapsed;
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
  return `${formatNumber(parsed.value)} ${formatUnitLabel(parsed.unit, parsed.value)}`;
}

export function formatTimeLabel(parsed: ParsedTime): string {
  return `Time: ${formatDuration(parsed)}`;
}
