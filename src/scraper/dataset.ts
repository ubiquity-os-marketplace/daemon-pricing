/**
 * Dataset utilities - Split data into train/validation and write JSONL files
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { FineTuneMessage } from "./formatter";

export interface DatasetSplit {
  train: FineTuneMessage[];
  validation: FineTuneMessage[];
}

export function splitDataset(messages: FineTuneMessage[], validationRatio = 0.2): DatasetSplit {
  // Shuffle deterministically
  const shuffled = [...messages].sort((a, b) =>
    JSON.stringify(a).length - JSON.stringify(b).length
  );

  const splitIdx = Math.floor(shuffled.length * (1 - validationRatio));
  return {
    train: shuffled.slice(0, splitIdx),
    validation: shuffled.slice(splitIdx),
  };
}

export function writeJsonl(messages: FineTuneMessage[], filePath: string): void {
  const dir = join(filePath, "..");
  mkdirSync(dir, { recursive: true });
  const lines = messages.map((m) => JSON.stringify(m)).join("\n");
  writeFileSync(filePath, lines + "\n", "utf-8");
}

export function createDataset(
  messages: FineTuneMessage[],
  outputDir = "data"
): { trainPath: string; validationPath: string; trainCount: number; validationCount: number } {
  const { train, validation } = splitDataset(messages);

  const trainPath = join(outputDir, "train.jsonl");
  const validationPath = join(outputDir, "validation.jsonl");

  writeJsonl(train, trainPath);
  writeJsonl(validation, validationPath);

  return {
    trainPath,
    validationPath,
    trainCount: train.length,
    validationCount: validation.length,
  };
}
