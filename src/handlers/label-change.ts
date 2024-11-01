import { isUserAdminOrBillingManager } from "../shared/issue";
import { ContextPlugin } from "../types/plugin-input";
import { isLabelEditedEvent } from "../types/typeguards";

export async function watchLabelChange(context: ContextPlugin) {
  const logger = context.logger;
  if (!isLabelEditedEvent(context)) {
    logger.debug("Not a label event");
    return;
  }

  const payload = context.payload;
  const { label, changes, sender } = payload;

  const previousLabel = changes?.name?.from;
  if (!previousLabel) {
    const errorMessage = "previous label name is undefined";
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }
  const currentLabel = label?.name;
  const triggerUser = sender?.login;
  const triggerUserId = sender?.id;

  if (!previousLabel || !currentLabel) {
    return logger.debug("No label name change.. skipping");
  }

  if (!triggerUser || !triggerUserId) {
    return logger.debug("No user found.. skipping");
  }

  // check if user is authorized to make the change
  const hasAccess = await hasLabelEditPermission(context, currentLabel, triggerUser);

  await context.adapters.supabase.label.saveLabelChange({
    previousLabel,
    currentLabel,
    authorized: hasAccess,
    repositoryId: payload.repository.id,
    userId: triggerUserId,
  });

  return logger.debug("label name change saved to db");
}

async function hasLabelEditPermission(context: ContextPlugin, label: string, caller: string) {
  const sufficientPrivileges = await isUserAdminOrBillingManager(context, caller);

  // get text before :
  const match = label.split(":");
  if (match.length == 0) return false;
  const labelType = match[0].toLowerCase();

  if (sufficientPrivileges) {
    // check permission
    const { access, user } = context.adapters.supabase;
    const userId = await user.getUserId(context, caller);
    const accessible = await access.getAccess(userId, context.payload.repository.id);
    return accessible !== null && accessible.labels?.includes(labelType) === true;
  }

  return true;
}
