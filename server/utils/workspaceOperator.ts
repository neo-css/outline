import env from "@server/env";
import User from "@server/models/User";

/**
 * Resolves the authorized operator behind an original or mapped account.
 *
 * @param user the authenticated Outline user.
 * @returns the active, allowlisted operator, or null.
 */
export async function getWorkspaceOperator(user: User): Promise<User | null> {
  const sourceId = user.workspaceAdminSourceId ?? user.id;
  if (
    env.isCloudHosted ||
    !env.WORKSPACE_OPERATOR_USER_IDS?.includes(sourceId)
  ) {
    return null;
  }

  const source = user.workspaceAdminSourceId
    ? await User.scope("withTeam").findByPk(sourceId)
    : user;

  return source && !source.isSuspended && !source.workspaceAdminSourceId
    ? source
    : null;
}

/**
 * Finds the browser and collaboration session owners affected by a sign-out.
 *
 * @param userId The original account being signed out or revoked.
 * @returns The account ID and its mapped account IDs.
 */
export async function getWorkspaceSessionUserIds(
  userId: string
): Promise<string[]> {
  if (env.isCloudHosted || !env.WORKSPACE_OPERATOR_USER_IDS?.includes(userId)) {
    return [userId];
  }

  const mappings = await User.findAll({
    attributes: ["id"],
    where: { workspaceAdminSourceId: userId },
    paranoid: false,
  });
  return [userId, ...mappings.map((user) => user.id)];
}
