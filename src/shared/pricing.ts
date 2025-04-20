import { Decimal } from "decimal.js";
import { determinePriorityOrder, extractLabelPattern } from "../handlers/label-checks.js";
import { Label } from "../types/github.js";
import { Context } from "../types/context.js";

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

  if (!timeLabel || !priorityLabel) throw logger.error("Time or priority label is not defined");

  const recognizedTimeLabels = labels.time.find((configLabel) => configLabel.name === timeLabel.name);
  if (!recognizedTimeLabels) throw logger.error("Time label is not recognized");

  const recognizedPriorityLabels = labels.priority.find((configLabel) => configLabel.name === priorityLabel.name);
  if (!recognizedPriorityLabels) throw logger.error("Priority label is not recognized");

  const timeValue = calculateLabelValue(context, recognizedTimeLabels.name);
  if (timeValue === null) throw logger.error("Time value is not defined");

  const priorityValue = calculateLabelValue(context, recognizedPriorityLabels.name);
  if (priorityValue === null) throw logger.error("Priority value is not defined");

  const taskPrice = calculateTaskPrice(context, timeValue, priorityValue);
  return `Price: ${taskPrice} USD`;
}

/*
 * Gets the value associated to the label. Returns null if the value of the label couldn't be extracted.
 */
export function calculateLabelValue(context: Context, label: string): number | null {
  const matches = label.match(/\d+/);
  if (!matches?.length) return null;
  const number = parseInt(matches[0]);
  const priorityRegex = extractLabelPattern(context.config.labels.priority);
  const timeRegex = extractLabelPattern(context.config.labels.time);
  if (priorityRegex.test(label)) {
    return number;
  } else if (timeRegex.test(label)) {
    if (label.toLowerCase().includes("minute")) return number * 0.002;
    if (label.toLowerCase().includes("hour")) return number * 0.125;
    if (label.toLowerCase().includes("day")) return 1 + (number - 1) * 0.25;
    if (label.toLowerCase().includes("week")) return number + 1;
    if (label.toLowerCase().includes("month")) return 5 + (number - 1) * 8;
  }
  return null;
}
