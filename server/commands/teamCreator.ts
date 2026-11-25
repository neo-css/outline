import type { InferCreationAttributes } from "sequelize";
import { traceFunction } from "@server/logging/tracing";
import { Team } from "@server/models";
import type { APIContext } from "@server/types";

type Props = {
  /** The displayed name of the team */
  name: string;
  /** The domain name from the email of the user logging in */
  domain?: string;
  /** The preferred subdomain to provision for the team if not yet created */
  subdomain: string;
  /** The public url of an image representing the team */
  avatarUrl?: string | null;
  /** The identifier of the team in the identity provider, if any */
  externalId?: string;
  /** Details of the authentication provider being used */
  authenticationProviders: {
    /** The name of the authentication provider, eg "google" */
    name: string;
    /** External identifier of the authentication provider */
    providerId: string;
  }[];
};

async function teamCreator(
  ctx: APIContext,
  { name, subdomain, avatarUrl, externalId, authenticationProviders }: Props
): Promise<Team> {
  if (!avatarUrl?.startsWith("http")) {
    avatarUrl = null;
  }

  const availableSubdomain = await Team.findAvailableSubdomain(subdomain, {
    transaction: ctx.state.transaction,
  });
  return await Team.createWithCtx(
    ctx,
    {
      name,
      subdomain: availableSubdomain,
      avatarUrl,
      externalId: externalId ?? null,
      authenticationProviders,
    } as Partial<InferCreationAttributes<Team>>,
    undefined,
    {
      include: ["authenticationProviders"],
    }
  );
}

export default traceFunction({
  spanName: "teamCreator",
})(teamCreator);
