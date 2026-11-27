import { subHours, subMinutes } from "date-fns";
import Router from "@koa/router";
import { uniqBy } from "es-toolkit/compat";
import { TeamPreference, UserRole } from "@shared/types";
import { parseDomain } from "@shared/utils/domains";
import { getActiveSessions } from "@shared/utils/sessions";
import env from "@server/env";
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
} from "@server/errors";
import auth from "@server/middlewares/authentication";
import { transaction } from "@server/middlewares/transaction";
import validate from "@server/middlewares/validate";
import { Event, Team, User } from "@server/models";
import AuthenticationHelper from "@server/models/helpers/AuthenticationHelper";
import {
  presentUser,
  presentTeam,
  presentPolicies,
  presentProviderConfig,
  presentAvailableTeam,
  presentGroup,
  presentGroupUser,
} from "@server/presenters";
import ValidateSSOAccessTask from "@server/queues/tasks/ValidateSSOAccessTask";
import type { APIContext } from "@server/types";
import { AuthenticationType } from "@server/types";
import { clearCSRFCookie } from "@server/utils/csrf";
import { getJWTPayload } from "@server/utils/jwt";
import { getWorkspaceOperator } from "@server/utils/workspaceOperator";
import { SessionsCookieHelper } from "@server/utils/SessionsCookieHelper";
import RateLimiter from "@server/utils/RateLimiter";
import {
  AuthSwitchWorkspaceSchema,
  type AuthConfigReq,
  type AuthDeleteReq,
  type AuthInfoReq,
  type AuthSwitchWorkspaceReq,
} from "./schema";

const router = new Router();

router.post("auth.config", async (ctx: APIContext<AuthConfigReq>) => {
  // If self hosted AND there is only one team then that team becomes the
  // brand for the knowledge base and its guest sign-in option is used for the
  // root login page. With several teams no single team is shown.
  if (!env.isCloudHosted) {
    const team = await Team.findSingle({
      scope: "withAuthenticationProviders",
    });

    ctx.body = {
      data: team
        ? {
            name: team.name,
            customTheme: team.getPreference(TeamPreference.CustomTheme),
            logo: team.getPreference(TeamPreference.PublicBranding)
              ? team.avatarUrl
              : undefined,
            providers: (await AuthenticationHelper.providersForTeam(team)).map(
              presentProviderConfig
            ),
          }
        : {
            providers: (await AuthenticationHelper.providersForTeam()).map(
              presentProviderConfig
            ),
          },
    };
    return;
  }

  const domain = parseDomain(ctx.request.hostname);

  if (domain.custom) {
    const team = await Team.scope("withAuthenticationProviders").findOne({
      where: {
        domain: ctx.request.hostname.toLowerCase(),
      },
    });

    if (team) {
      ctx.body = {
        data: {
          name: team.name,
          customTheme: team.getPreference(TeamPreference.CustomTheme),
          logo: team.getPreference(TeamPreference.PublicBranding)
            ? team.avatarUrl
            : undefined,
          hostname: ctx.request.hostname,
          providers: (await AuthenticationHelper.providersForTeam(team)).map(
            presentProviderConfig
          ),
        },
      };
      return;
    }
  }

  // If subdomain signin page then we return minimal team details to allow
  // for a custom screen showing only relevant signin options for that team.
  else if (env.isCloudHosted && domain.teamSubdomain) {
    const team = await Team.scope("withAuthenticationProviders").findOne({
      where: {
        subdomain: domain.teamSubdomain,
      },
    });

    if (team) {
      ctx.body = {
        data: {
          name: team.name,
          customTheme: team.getPreference(TeamPreference.CustomTheme),
          logo: team.getPreference(TeamPreference.PublicBranding)
            ? team.avatarUrl
            : undefined,
          hostname: ctx.request.hostname,
          providers: (await AuthenticationHelper.providersForTeam(team)).map(
            presentProviderConfig
          ),
        },
      };
      return;
    }
  }

  // Otherwise, we're requesting from the standard root signin page
  ctx.body = {
    data: {
      providers: (await AuthenticationHelper.providersForTeam()).map(
        presentProviderConfig
      ),
    },
  };
});

/** Authentication services that don't require SSO validation. */
const NON_SSO_SERVICES = ["email", "passkeys"];

router.post("auth.info", auth(), async (ctx: APIContext<AuthInfoReq>) => {
  const { user, service, type, token } = ctx.state.auth;
  const operator =
    type === AuthenticationType.APP ? await getWorkspaceOperator(user) : null;
  const [team, groups, availableTeams] = await Promise.all([
    Team.scope("withDomains").findByPk(user.teamId, {
      rejectOnEmpty: true,
    }),
    user.groups(),
    operator
      ? Team.findAll({
          where: { suspendedAt: null },
          order: [["name", "ASC"]],
        })
      : user.availableTeams(),
  ]);
  const expiresAt =
    type === AuthenticationType.APP
      ? getJWTPayload(token).expiresAt
      : undefined;
  const rememberedTeams = await SessionsCookieHelper.reconcile(
    ctx,
    type === AuthenticationType.APP ? team : undefined,
    typeof expiresAt === "string" ? new Date(expiresAt) : undefined
  );
  const signedInTeamIds = new Set(
    Object.keys(getActiveSessions(SessionsCookieHelper.read(ctx)))
  );

  // If the user did not _just_ sign in then we need to check if they continue
  // to have access to the workspace they are signed into. This only applies
  // to SSO sessions - email and passkey logins don't have associated
  // UserAuthentication records that need validation.
  const requiresSSOValidation =
    !user.workspaceAdminSourceId &&
    (!service || !NON_SSO_SERVICES.includes(service));
  if (
    requiresSSOValidation &&
    user.lastSignedInAt &&
    user.lastSignedInAt < subHours(new Date(), 1)
  ) {
    await new ValidateSSOAccessTask()
      .schedule({
        userId: user.id,
      })
      .catch(() => {
        // Ignore errors from duplicate jobId when a validation is already queued
      });
  }

  ctx.body = {
    data: {
      user: presentUser(user, {
        includeDetails: true,
      }),
      team: presentTeam(team),
      groups: await Promise.all(groups.map(presentGroup)),
      groupUsers: groups.map((group) => presentGroupUser(group.groupUsers[0])),
      // The collaboration token is only for the client and should not be issued
      // to API or OAuth consumers
      collaborationToken:
        type === AuthenticationType.APP
          ? user.getCollaborationToken()
          : undefined,
      availableTeams: uniqBy([...rememberedTeams, ...availableTeams], "id")
        .filter(
          (availableTeam) =>
            !!operator ||
            env.isCloudHosted ||
            availableTeam.id === team.id ||
            availableTeam.url !== team.url
        )
        .map((availableTeam) => ({
          ...presentAvailableTeam(
            availableTeam,
            signedInTeamIds.has(availableTeam.id) ||
              availableTeam.id === user.teamId
          ),
          ...(operator ? { canSwitchInPlace: true } : {}),
        })),
    },
    policies: presentPolicies(user, [team, user, ...groups]),
  };
});

router.post(
  "auth.switchWorkspace",
  auth({ type: AuthenticationType.APP, transports: ["cookie"] }),
  validate(AuthSwitchWorkspaceSchema),
  async (ctx: APIContext<AuthSwitchWorkspaceReq>) => {
    const { user, token, service } = ctx.state.auth;
    const operator = await getWorkspaceOperator(user);
    if (!operator) {
      throw AuthorizationError("Workspace operator access required");
    }

    const sessionExpiry = getJWTPayload(token).expiresAt;
    const expiresAt =
      typeof sessionExpiry === "string" ? new Date(sessionExpiry) : null;
    if (!expiresAt || !Number.isFinite(expiresAt.getTime())) {
      throw AuthenticationError(
        "Workspace switching requires an expiring session"
      );
    }

    const team = await Team.findByPk(ctx.input.body.teamId);
    if (!team || team.isSuspended) {
      throw NotFoundError("Workspace not available");
    }

    const [target] = await User.findOrCreate({
      where: { teamId: team.id, workspaceAdminSourceId: operator.id },
      defaults: {
        name: operator.name,
        language: operator.language,
        role: UserRole.Admin,
        lastActiveAt: new Date(),
      },
      paranoid: false,
    });
    if (target.deletedAt || target.isSuspended || !target.isAdmin) {
      throw AuthorizationError(
        "Workspace administrator account is unavailable"
      );
    }

    ctx.cookies.set(
      "accessToken",
      target.getSessionToken(expiresAt, service, operator.id),
      { sameSite: "lax", expires: expiresAt }
    );
    clearCSRFCookie(ctx);
    ctx.body = { success: true };
  }
);

router.post(
  "auth.delete",
  auth(),
  transaction(),
  async (ctx: APIContext<AuthDeleteReq>) => {
    const { auth, transaction } = ctx.state;
    const { user, token } = auth;

    await user.rotateJwtSecret({ transaction });
    await Event.createFromContext(ctx, {
      name: "users.signout",
      userId: user.id,
      data: {
        name: user.name,
        reason: "manual",
      },
    });

    void RateLimiter.clearCachedToken(token);

    ctx.cookies.set("accessToken", "", {
      sameSite: "lax",
      expires: subMinutes(new Date(), 1),
    });
    clearCSRFCookie(ctx);
    SessionsCookieHelper.logout(ctx, user.teamId);

    ctx.body = {
      success: true,
    };
  }
);

export default router;
