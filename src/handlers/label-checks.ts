import { AssistivePricingSettings } from "../types/plugin-input";

type Labels = AssistivePricingSettings["labels"]["priority" | "time"];

function extractCommonPattern(labels: Labels): string {
  const labelParts = labels.map((label) => {
    const numberMatch = RegExp(/(\D*)(\d*\.?\d+)(\D*)/).exec(label.name);
    if (!numberMatch) {
      throw new Error("Labels do not seem to contain any number value, please check your configuration.");
    }
    return {
      prefix: numberMatch[1],
      number: numberMatch[2],
      suffix: numberMatch[3],
    };
  });

  const prefixes = labelParts.map((p) => p.prefix);
  const suffixes = labelParts.map((p) => p.suffix);

  const commonPrefixes = prefixes.reduce<string>((acc, curr) => (acc === curr ? acc : ""), prefixes[0]);
  const commonSuffixes = suffixes.reduce<string>((acc, curr) => (acc === curr ? acc : ""), suffixes[0]);

  if (!commonPrefixes && !commonSuffixes) {
    throw new Error("No common prefixes or suffixes have been found for the label list, please check your configuration.");
  }

  return `${commonPrefixes.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d*\\.?\\d+)${commonSuffixes.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
}

function extractNumbers(labels: Labels) {
  return labels.map((tag) => {
    const match = RegExp(/\d*\.?\d+/).exec(tag.name);
    return match ? parseInt(match[0], 10) : null;
  });
}

function extractLabelPattern(labels: Labels) {
  const priorities = extractNumbers(labels);

  if (priorities.some((p) => p === null)) {
    throw new Error("Some tags seem to not have any number value, please check your configuration.");
  }

  const commonPattern = extractCommonPattern(labels);

  return new RegExp(commonPattern, "i");
}

function determinePriorityOrder(tags: Labels): number {
  const patternInfo = extractLabelPattern(tags);

  if (!patternInfo) {
    throw new Error(`Could not determine the label pattern. Tags: ${JSON.stringify(tags)}`);
  }

  function extractPriority(tag: string): number {
    const match = patternInfo?.exec(tag);
    return match ? parseInt(match[1], 10) : -1;
  }

  const firstPriority = extractPriority(tags[0].name);
  const secondPriority = extractPriority(tags[1].name);

  return firstPriority < secondPriority ? 1 : -1;
}

export { extractLabelPattern, determinePriorityOrder };
