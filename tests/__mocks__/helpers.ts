import { Context } from "../../src/types/context";
import { AUTHED_USER, BILLING_MANAGER, PRICE_LABELS, PRIORITY_LABELS, TIME_LABELS, UNAUTHED_USER } from "./constants";
import { resetConfig, setConfig } from "./config-store";
import { db } from "./db";
import issueTemplate from "./issue-template";
import { STRINGS } from "./strings";
import usersGet from "./users-get.json";

const PLUGIN_KEY = "ubiquity-os-marketplace/daemon-pricing";

export function getBaseRateChanges(changeAmt: number, withChanges = true, withPlugin = false) {
  return `
  diff--git a /.github /.ubiquity-os - config.yml b /.github /.ubiquity-os - config.yml
  index f7f8053..cad1340 100644
  --- a /.github /.ubiquity-os - config.yml
  +++ b /.github /.ubiquity-os - config.yml
  @@ - 7, 7 + 7, 7 @@features:
       shouldFundContributorClosedIssue: false
  ${
    withChanges
      ? `
  payments: 
  -  basePriceMultiplier: 1
  +  basePriceMultiplier: ${changeAmt}`
      : ""
  }
      timers:
      reviewDelayTolerance: 86400000
      taskStaleTimeoutDuration: 2419200000
  ${
    withPlugin
      ? `
    with: 
      labels:
@ -40,115 +36,124 @@
        assistivePricing: true
  `
      : ""
  }
      `;
}

export function buildPluginConfigYaml(basePriceMultiplier: number, excludeRepos: string[] = [], labels: typeof PRIORITY_LABELS = PRIORITY_LABELS): string {
  const priorityYaml = labels
    .map(
      (label) => `        - name: "${label.name}"
          collaboratorOnly: false`
    )
    .join("\n");

  const excludeLines = excludeRepos.length
    ? ["      globalConfigUpdate:", "        excludeRepos:", ...excludeRepos.map((repo) => `        - ${repo}`)]
    : ["      globalConfigUpdate:", "        excludeRepos: []"];

  return [
    "plugins:",
    `  ${PLUGIN_KEY}:`,
    "    with:",
    `      basePriceMultiplier: ${basePriceMultiplier}`,
    "      labels:",
    "        priority:",
    priorityYaml,
    ...excludeLines,
  ].join("\n");
}

export function seedPluginConfigs({
  owner,
  repo,
  beforeRef,
  beforeBasePriceMultiplier,
  afterBasePriceMultiplier,
  excludeRepos,
  beforeLabels,
  afterLabels,
}: {
  owner: string;
  repo: string;
  beforeRef: string;
  beforeBasePriceMultiplier: number;
  afterBasePriceMultiplier: number;
  excludeRepos: string[];
  beforeLabels?: typeof PRIORITY_LABELS;
  afterLabels?: typeof PRIORITY_LABELS;
}) {
  setConfig({
    owner,
    repo,
    path: STRINGS.CONFIG_PATH,
    content: buildPluginConfigYaml(afterBasePriceMultiplier, excludeRepos, afterLabels),
  });

  setConfig({
    owner,
    repo,
    path: STRINGS.CONFIG_PATH,
    ref: beforeRef,
    content: buildPluginConfigYaml(beforeBasePriceMultiplier, excludeRepos, beforeLabels),
  });
}

export function getAuthor(isAuthed: boolean, isBilling: boolean) {
  if (isAuthed) {
    return AUTHED_USER;
  }

  if (isBilling) {
    return BILLING_MANAGER;
  }

  return UNAUTHED_USER;
}

export function inMemoryCommits(id: string, isAuthed = true, withBaseRateChanges = true, isBilling = false): Context<"push">["payload"]["commits"] {
  return [
    {
      author: getAuthor(isAuthed, isBilling),
      committer: getAuthor(isAuthed, isBilling),
      id: id,
      message: "chore: update base rate",
      timestamp: new Date().toISOString(),
      tree_id: id,
      url: "",
      added: [],
      modified: withBaseRateChanges ? [STRINGS.CONFIG_PATH] : [],
      removed: [],
      distinct: true,
    },
  ];
}

export function createCommit({
  owner,
  repo,
  sha,
  modified,
  added,
  withBaseRateChanges,
  withPlugin,
  amount,
}: {
  owner: string;
  repo: string;
  sha: string;
  modified: string[];
  added: string[];
  withBaseRateChanges: boolean;
  withPlugin: boolean;
  amount: number;
}) {
  if (db.commit.findFirst({ where: { sha: { equals: sha } } })) {
    db.commit.delete({ where: { sha: { equals: sha } } });
  }
  db.commit.create({
    id: 1,
    owner: {
      login: owner,
    },
    repo,
    sha,
    modified,
    added,
    data: getBaseRateChanges(amount, withBaseRateChanges, withPlugin),
  });
}

export async function setupTests() {
  resetConfig();
  for (const item of usersGet) {
    db.users.create(item);
  }

  db.repo.create({
    id: 1,
    html_url: `https://github.com/repos/${STRINGS.UBIQUITY}/${STRINGS.TEST_REPO}`,
    name: STRINGS.TEST_REPO,
    owner: {
      login: STRINGS.UBIQUITY,
      id: 1,
    },
    issues: [],
    labels: [...PRICE_LABELS, ...TIME_LABELS, ...PRIORITY_LABELS],
  });

  db.issue.create({
    ...issueTemplate,
  });

  db.issue.create({
    ...issueTemplate,
    id: 2,
    number: 2,
    labels: [],
  });

  db.issue.create({
    ...issueTemplate,
    id: 3,
    number: 3,
    labels: [
      {
        name: "Time: 1 Hour",
      },
      {
        name: "Priority: 1 (Normal)",
      },
    ],
  });
}
