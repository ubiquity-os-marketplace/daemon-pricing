import { addCommentToIssue, isUserAdminOrBillingManager } from "../shared/issue";
import { ContextPlugin } from "../types/plugin-input";
import { isCommentEvent } from "../types/typeguards";
import commandParser, { AllowedCommand, CommandArguments, isValidCommand } from "./command-parser";

const commandHandlers: { [k in AllowedCommand]: (context: ContextPlugin, commandArguments: CommandArguments) => Promise<void> } = {
  async allow(context, { username, labels }: CommandArguments) {
    const logger = context.logger;
    if (!isCommentEvent(context)) {
      logger.debug("Not an comment event");
      return;
    }
    const payload = context.payload;
    const sender = payload.sender?.login;
    const { access, user } = context.adapters.supabase;
    const url = payload.comment?.html_url;
    if (!url) throw new Error("Comment url is undefined");

    const userId = await user.getUserId(context, username);
    await access.setAccess(userId, payload.repository.id, labels);
    if (!labels.length) {
      return await addCommentToIssue(context, `@${sender}, successfully cleared access for @${username}`, payload.issue.number);
    }
    return await addCommentToIssue(context, `@${sender}, successfully set access for @${username}`, payload.issue.number);
  },
};

export async function handleComment(context: ContextPlugin) {
  const logger = context.logger;
  if (!isCommentEvent(context)) {
    return logger.debug("Not an comment event");
  }

  const payload = context.payload;
  const sender = payload.sender?.login;

  const body = payload.comment.body.trim();

  if (!isValidCommand(body)) {
    return logger.debug("Not a valid command.");
  }

  const sufficientPrivileges = await isUserAdminOrBillingManager(context, sender);
  if (!sufficientPrivileges) {
    await addCommentToIssue(context, `@${sender}, You are not allowed to set access`, payload.issue.number);
  }

  try {
    const command = parseComment(body);
    await commandHandlers[command.command](context, command);
  } catch (e) {
    await addCommentToIssue(
      context,
      `\`\`\`
daemon-pricing plugin failed to run.
${e}

${commandParser.helpInformation()}
\`\`\``,
      payload.issue.number
    );
  }
}

function parseComment(comment: string): CommandArguments {
  let result: CommandArguments | null = null;

  commandParser
    .action((command, user, labels) => {
      result = { command, username: user, labels };
    })
    .parse(comment.split(/\s+/), { from: "user" });

  if (!result) {
    throw new Error("The command could not be parsed.");
  }
  return result;
}
