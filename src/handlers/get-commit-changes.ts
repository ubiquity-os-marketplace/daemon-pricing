import { Context } from "../types/context";

// Collects all the modified and added files from the commits.
export function getCommitChanges(commits: Context<"push">["payload"]["commits"]): string[] {
  const changes: string[] = [];

  for (const commit of commits) {
    if (commit.modified?.length) {
      for (const modifiedFile of commit.modified) {
        changes.push(modifiedFile);
      }
    }

    if (commit.added?.length) {
      for (const addedFile of commit.added) {
        changes.push(addedFile);
      }
    }
  }

  return changes;
}
