import { Decimal } from "decimal.js";
import { determinePriorityOrder, extractLabelPattern } from "../handlers/label-checks";
import { parseTimeLabel } from "../utils/time-labels";
import { Label } from "../types/github";
import { Context } from "../types/context";

export function calculateTaskPrice(context: Context, timeValue: number, priorityValue: number, baseValue?: number): string {
  const base = baseValue ?? context.config.basePriceMultiplier;
  let priority = new Decimal(priorityValue).div(10); // floats cause bad math
  const priorityOrder = determinePriorityOrder(context.config.labels.priority);
  if (priorityOrder < 0) {
    const highestPriority = context.config.labels.priority.reduce((acc, curr) => {
      const value = RegExp(/\d+/).exec(curr.name);
      if (value !== null) {
        const valueNumber = Number(value);
        if (valueNumber > acc) {
          return valueNumber;
        }
      }
      return acc;
    }, 0);
    priority = new Decimal(highestPriority - priorityValue).div(10);
  }
  return new Decimal(base).mul(1000).mul(timeValue).mul(priority).toDecimalPlaces(2).toString();
}

export function getPrice(context: Context, timeLabel: Label, priorityLabel: Label) {
  const logger = context.logger;
  const { labels } = context.config;

  if (!timeLabel || !priorityLabel) throw logger.warn("Time or priority label is not defined");

  const recognizedPriorityLabels = labels.priority.find((configLabel) => configLabel.name === priorityLabel.name);
  if (!recognizedPriorityLabels) throw logger.warn("Priority label is not recognized");

  const timeValue = calculateLabelValue(context, timeLabel.name);
  if (timeValue === null) throw logger.warn("Time value is not defined");

  const priorityValue = calculateLabelValue(context, recognizedPriorityLabels.name);
  if (priorityValue === null) throw logger.warn("Priority value is not defined");

  const taskPrice = calculateTaskPrice(context, timeValue, priorityValue);
  return `Price: ${taskPrice} USD`;
}

/*
 * Gets the value associated to the label. Returns null if the value of the label couldn't be extracted.
 */
export function calculateLabelValue(context: Context, label: string): number | null {
  const priorityRegex = extractLabelPattern(context.config.labels.priority);
  if (priorityRegex.test(label)) {
    const matches = label.match(/\d+(?:\.\d+)?/);
    if (!matches?.length) return null;
    return Number.parseFloat(matches[0]);
  }

  const parsed = parseTimeLabel(label);
  if (!parsed) return null;

  const number = parsed.value;
  switch (parsed.unit) {
    case "minute":
      return number * 0.002;
    case "hour":
      return number * 0.125;
    case "day":
      return 1 + (number - 1) * 0.25;
    case "week":
      return number + 1;
    case "month":
      return 5 + (number - 1) * 8;
    default:
      return null;
  }
}
