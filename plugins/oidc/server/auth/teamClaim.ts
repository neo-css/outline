import { get } from "es-toolkit/compat";
import { TeamValidation } from "@shared/validations";
import { AuthenticationError } from "@server/errors";
import env from "../env";

/** The workspace a user belongs to, as asserted by the identity provider. */
export interface TeamClaim {
  /** The identifier of the workspace in the identity provider. */
  externalId: string;
  /** The name to use if the workspace needs to be created. */
  name?: string;
}

/**
 * Reads the workspace a user belongs to from their OIDC claims when
 * OIDC_TEAM_CLAIM is configured.
 *
 * @param sources the claim sources in order of preference, eg userinfo then id_token.
 * @returns the workspace claim, or undefined when OIDC_TEAM_CLAIM is not configured.
 * @throws AuthenticationError if the configured claim is missing or invalid.
 */
export function getTeamClaim(...sources: object[]): TeamClaim | undefined {
  const teamClaim = env.OIDC_TEAM_CLAIM;
  if (!teamClaim) {
    return undefined;
  }

  const externalId = readClaim(sources, teamClaim);
  if (!externalId) {
    throw AuthenticationError(
      `A "${teamClaim}" field was not returned in the profile or id_token parameter, but is required to choose a workspace.`
    );
  }
  if (externalId.length > 255) {
    throw AuthenticationError(
      `The "${teamClaim}" field must be 255 characters or less.`
    );
  }

  const name = env.OIDC_TEAM_NAME_CLAIM
    ? readClaim(sources, env.OIDC_TEAM_NAME_CLAIM)?.slice(
        0,
        TeamValidation.maxNameLength
      )
    : undefined;

  return { externalId, name: name || undefined };
}

function readClaim(sources: object[], claim: string): string | undefined {
  for (const source of sources) {
    const record = source as Record<string, unknown>;
    const value: unknown = Object.hasOwn(record, claim)
      ? record[claim]
      : get(source, claim);

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}
