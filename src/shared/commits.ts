import { COMMIT_MESSAGE } from "../types/constants.js";
import { Context } from "../types/context.js";

export async function pushEmptyCommit(context: Context) {
  const { octokit, payload, logger } = context;

  const owner = payload.repository.owner?.login;
  const repo = payload.repository.name;
  const ref = `heads/${payload.repository.default_branch}`;

  if (!owner) {
    throw logger.error("No owner was found in the repository, a commit / push action cannot be performed.", {
      payload,
    });
  }

  const refResponse = await octokit.rest.git.getRef({
    owner,
    repo,
    ref,
  });
  const latestCommitSha = refResponse.data.object.sha;
  const commitResponse = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: latestCommitSha,
  });
  const treeSha = commitResponse.data.tree.sha;
  const newCommitResponse = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: COMMIT_MESSAGE,
    tree: treeSha,
    parents: [latestCommitSha],
  });
  const newCommitSha = newCommitResponse.data.sha;
  const { data } = await octokit.rest.git.updateRef({
    owner,
    repo,
    ref,
    sha: newCommitSha,
  });
  logger.info(`Pushed an empty commit to ${payload.repository.html_url}`, {
    commitUrl: data.url,
  });
}
