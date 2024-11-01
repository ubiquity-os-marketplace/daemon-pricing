import { Label } from "../types/github";
import { ContextPlugin } from "../types/plugin-input";

// cspell:disable
export const COLORS = { default: "ededed", price: "1f883d" };
// cspell:enable

const NO_REPO_OWNER = "No owner found in the repository!";

export async function listLabelsForRepo(context: ContextPlugin): Promise<Label[]> {
  const { payload, octokit } = context;

  const owner = payload.repository.owner?.login;
  if (!owner) {
    throw context.logger.error(NO_REPO_OWNER);
  }
  // we need to paginate because the devpool has hundreds of labels
  const res = await octokit.paginate(octokit.rest.issues.listLabelsForRepo, {
    owner,
    repo: payload.repository.name,
    per_page: 100,
    page: 1,
  });

  if (res.length > 0) {
    // we'll hit a secondary rate limit if using the runner token
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return res;
  }

  throw context.logger.error("Failed to fetch lists of labels", { status: 500 });
}

export async function createLabel(context: ContextPlugin, name: string, labelType = "default" as keyof typeof COLORS): Promise<void> {
  const payload = context.payload;

  const color = name.startsWith("Price: ") ? COLORS.price : COLORS[labelType];
  const owner = payload.repository.owner?.login;
  if (!owner) {
    throw context.logger.error(NO_REPO_OWNER);
  }

  try {
    await context.octokit.rest.issues.createLabel({
      owner,
      repo: payload.repository.name,
      name,
      color,
    });
  } catch (err) {
    throw context.logger.error("Creating a label failed!", { err });
  }
}

export async function clearAllPriceLabelsOnIssue(context: ContextPlugin) {
  const payload = context.payload;
  if (!("issue" in payload) || !payload.issue) {
    return;
  }

  const labels = payload.issue.labels;
  if (!labels) return;
  const issuePriceLabels = labels.filter((label) => label.name.toString().startsWith("Price: ") || label.name.toString().startsWith("Pricing: "));
  if (!issuePriceLabels.length) return;

  for (const label of issuePriceLabels) {
    try {
      await context.octokit.rest.issues.removeLabel({
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        issue_number: payload.issue.number,
        name: label.name,
      });
    } catch (err: unknown) {
      throw context.logger.error("Clearing all price labels failed!", { err });
    }
  }
}
export async function addLabelToIssue(context: ContextPlugin, labelName: string) {
  const payload = context.payload;
  if (!("issue" in payload) || !payload.issue) {
    return;
  }

  try {
    await context.octokit.rest.issues.addLabels({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
      labels: [labelName],
    });
  } catch (err: unknown) {
    throw context.logger.error("Adding a label to issue failed!", { err });
  }
}

export async function removeLabelFromIssue(context: ContextPlugin, labelName: string) {
  const payload = context.payload;
  if (!("issue" in payload) || !payload.issue) {
    return;
  }

  try {
    await context.octokit.rest.issues.removeLabel({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      issue_number: payload.issue.number,
      name: labelName,
    });
  } catch (err: unknown) {
    throw context.logger.error("Adding a label to issue failed!", { err });
  }
}
