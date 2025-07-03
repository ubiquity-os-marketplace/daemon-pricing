import ms from "ms";
import { Context } from "../types/context";
import { Label } from "../types/github";

export function parseTimeLabel(label: string): number | null {
  const match = RegExp(/^Time:\s*<?\s*(.+)$/i).exec(label);
  if (!match) return null;
  const timePart = match[1].trim();

  return ms(timePart);
}

export async function findClosestTimeLabel(context: Context, input: string): Promise<string> {
  const { logger } = context;

  const targetMs = ms(input);
  if (!targetMs) {
    throw logger.warn(`The provided time \`${input}\` is invalid.`, { input });
  }

  if (!context.payload.repository.owner) {
    throw logger.warn("No owner was found in the payload.");
  }

  const labels = await context.octokit.paginate(context.octokit.rest.issues.listLabelsForRepo, {
    owner: context.payload.repository.owner.login,
    repo: context.payload.repository.name,
    per_page: 100,
  });

  const validLabels = labels
    .map((label: Label) => ({
      name: label.name,
      ms: parseTimeLabel(label.name),
    }))
    .filter((item): item is { name: string; ms: number } => item.ms !== null && item.name.startsWith("Time:"));

  if (validLabels.length === 0) {
    throw logger.warn(`No valid time labels matching \`${input}\` was found in the repository.`, { labels });
  }

  const closest = validLabels.reduce((best, current) => {
    const currentDiff = Math.abs(current.ms - targetMs);
    const bestDiff = Math.abs(best.ms - targetMs);
    return currentDiff < bestDiff ? current : best;
  }, validLabels[0]);

  logger.info("Selected time label", {
    input,
    targetMs,
    selectedLabel: closest.name,
    selectedMs: closest.ms,
  });

  return closest.name;
}
