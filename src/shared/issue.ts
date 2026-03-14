import { logByStatus } from "./logging";
import { Context } from "../types/context";

const REPO_WRITE_PLUS_PERMISSIONS = new Set(["write", "maintain", "admin"]);

async function checkIfIsAdmin(context: Context, username: string) {
  const owner = context.payload.repository.owner?.login;
  if (!owner) {
    context.logger.warn("No owner found in the repository!");
    throw new Error("No owner found in the repository!");
  }
  const response = await context.octokit.rest.repos.getCollaboratorPermissionLevel({
    owner,
    repo: context.payload.repository.name,
    username,
  });
  return response.data.permission === "admin";
}

async function checkIfIsBillingManager(context: Context, username: string) {
  if (!context.payload.organization) {
    context.logger.warn("No organization found in payload!");
    throw new Error("No organization found in payload!");
  }

  try {
    await context.octokit.rest.orgs.checkMembershipForUser({
      org: context.payload.organization.login,
      username,
    });
  } catch {
    return false;
  }

  const { data: membership } = await context.octokit.rest.orgs.getMembershipForUser({
    org: context.payload.organization.login,
    username,
  });
  return membership.role === "billing_manager";
}

function isUserOrganizationBot(context: Context) {
  const { payload } = context;

  return payload.sender?.type === "Bot";
}

async function checkIfHasRepoWritePlusPermission(context: Context, username: string) {
  const owner = context.payload.repository.owner?.login;
  if (!owner) {
    context.logger.warn("No owner found in the repository!");
    return false;
  }

  try {
    const response = await context.octokit.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo: context.payload.repository.name,
      username,
    });
    return REPO_WRITE_PLUS_PERMISSIONS.has(response.data.permission);
  } catch (err) {
    logByStatus(context.logger, "Failed to fetch collaborator permission level for /time command.", err, { username });
    return false;
  }
}

async function getTimeCommandOrgRole(context: Context, username: string): Promise<"billing_manager" | "org_member" | false> {
  const org = context.payload.organization?.login;
  if (!org) {
    return false;
  }

  try {
    await context.octokit.rest.orgs.checkMembershipForUser({
      org,
      username,
    });
  } catch {
    return false;
  }

  try {
    const { data: membership } = await context.octokit.rest.orgs.getMembershipForUser({
      org,
      username,
    });
    if (membership.role === "billing_manager") {
      return "billing_manager";
    }
  } catch (err) {
    logByStatus(context.logger, "Failed to fetch organization role for /time command.", err, { username, org });
  }

  return "org_member";
}

export async function isUserAdminOrBillingManager(context: Context, username?: string): Promise<"admin" | "billing_manager" | false> {
  if (!username) return false;
  const isAdmin = (await checkIfIsAdmin(context, username)) || isUserOrganizationBot(context);
  if (isAdmin) return "admin";

  const isBillingManager = await checkIfIsBillingManager(context, username);
  if (isBillingManager) return "billing_manager";

  return false;
}

export async function canRunTimeCommand(
  context: Context,
  username?: string
): Promise<"issue_author" | "org_member" | "billing_manager" | "repo_write_plus" | false> {
  if (!username) return false;

  if ("issue" in context.payload && context.payload.issue?.user?.login === username) {
    return "issue_author";
  }

  const orgRole = await getTimeCommandOrgRole(context, username);
  if (orgRole) {
    return orgRole;
  }

  const hasRepoWritePlusPermission = await checkIfHasRepoWritePlusPermission(context, username);
  if (hasRepoWritePlusPermission) {
    return "repo_write_plus";
  }

  return false;
}

export async function listOrgRepos(context: Context) {
  const org = context.payload.organization?.login;
  if (!org) {
    context.logger.warn("No organization found in payload!", { payload: context.payload });
    throw new Error("No organization found in payload!");
  }

  try {
    const response = await context.octokit.rest.repos.listForOrg({
      org,
    });
    return response.data.filter((repo) => !repo.archived && !repo.disabled && !context.config.globalConfigUpdate?.excludeRepos.includes(repo.name));
  } catch (err) {
    logByStatus(context.logger, "Listing org repos failed!", err);
    throw err instanceof Error ? err : new Error("Listing org repos failed!");
  }
}

export async function listRepoIssues(context: Context, owner: string, repo: string) {
  try {
    return await context.octokit.paginate(context.octokit.rest.issues.listForRepo, {
      owner,
      repo,
    });
  } catch (err) {
    logByStatus(context.logger, "Listing repo issues failed!", err);
    throw err instanceof Error ? err : new Error("Listing repo issues failed!");
  }
}
