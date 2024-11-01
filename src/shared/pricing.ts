import { Decimal } from "decimal.js";
import { Label } from "../types/github";
import { ContextPlugin } from "../types/plugin-input";

export function calculateTaskPrice(context: ContextPlugin, timeValue: number, priorityValue: number, baseValue?: number): string {
  const base = baseValue ?? context.config.basePriceMultiplier;
  const priority = new Decimal(priorityValue).div(10); // floats cause bad math
  return new Decimal(base).mul(1000).mul(timeValue).mul(priority).toDecimalPlaces(2).toString();
}

export function getPrice(context: ContextPlugin, timeLabel: Label, priorityLabel: Label) {
  const logger = context.logger;
  const { labels } = context.config;

  if (!timeLabel || !priorityLabel) throw logger.error("Time or priority label is not defined");

  const recognizedTimeLabels = labels.time.find((configLabel) => configLabel === timeLabel.name);
  if (!recognizedTimeLabels) throw logger.error("Time label is not recognized");

  const recognizedPriorityLabels = labels.priority.find((configLabel) => configLabel === priorityLabel.name);
  if (!recognizedPriorityLabels) throw logger.error("Priority label is not recognized");

  const timeValue = calculateLabelValue(recognizedTimeLabels);
  if (!timeValue) throw logger.error("Time value is not defined");

  const priorityValue = calculateLabelValue(recognizedPriorityLabels);
  if (!priorityValue) throw logger.error("Priority value is not defined");

  const taskPrice = calculateTaskPrice(context, timeValue, priorityValue);
  return `Price: ${taskPrice} USD`;
}

export function calculateLabelValue(label: string): number {
  const matches = label.match(/\d+/);
  const number = matches && matches.length > 0 ? parseInt(matches[0]) || 0 : 0;
  if (label.toLowerCase().includes("priority")) return number;
  if (label.toLowerCase().includes("minute")) return number * 0.002;
  if (label.toLowerCase().includes("hour")) return number * 0.125;
  if (label.toLowerCase().includes("day")) return 1 + (number - 1) * 0.25;
  if (label.toLowerCase().includes("week")) return number + 1;
  if (label.toLowerCase().includes("month")) return 5 + (number - 1) * 8;
  return 0;
}
