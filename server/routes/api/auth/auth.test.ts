import { faker } from "@faker-js/faker";
import Koa from "koa";
import { randomUUID } from "node:crypto";
import { CSRF } from "@shared/constants";
import { Scope, UserRole } from "@shared/types";
import env from "@server/env";
import { defaultRateLimiter } from "@server/middlewares/rateLimiter";
import { Event, User, UserAuthentication } from "@server/models";
import onerror from "@server/onerror";
import ValidateSSOAccessTask from "@server/queues/tasks/ValidateSSOAccessTask";
import webService from "@server/services/web";
import {
  buildAdmin,
  buildApiKey,
  buildOAuthAuthentication,
  buildUser,
  buildTeam,
  buildUserPasskey,
  buildSubdomain,
} from "@server/test/factories";
import { getTestServer, setSelfHosted } from "@server/test/support";
import TestServer from "@server/test/TestServer";
import { bundleToken, generateRawToken } from "@server/utils/csrf";
import { getJWTPayload, getUserForJWT } from "@server/utils/jwt";
import RateLimiter from "@server/utils/RateLimiter";

const server = getTestServer();

describe("#auth.info", () => {
  it("should return current authentication", async () => {
    const team = await buildTeam();
    const team2 = await buildTeam();
    const team3 = await buildTeam();

    const user = await buildUser({ teamId: team.id });
    await buildUser();
    await buildUser({
      teamId: team2.id,
      email: user.email,
    });
    const res = await server.post("/api/auth.info", user, {
      headers: {
        Host: "app.outline.dev",
        Cookie: `sessions=${encodeURIComponent(
          JSON.stringify({
            [team3.id]: {
              name: team3.name,
              logoUrl: team3.avatarUrl,
              url: team3.url,
            },
          })
        )}`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);

    const availableTeamIds = body.data.availableTeams.map(
      (t: { id: string }) => t.id
    );

    expect(availableTeamIds.length).toEqual(3);
    expect(availableTeamIds).toContain(team.id);
    expect(availableTeamIds).toContain(team2.id);
    expect(availableTeamIds).toContain(team3.id);

    const isSignedIn = (id: string) =>
      body.data.availableTeams.find((t: { id: string }) => t.id === id)
        .isSignedIn;
    expect(isSignedIn(team.id)).toBe(true);
    expect(isSignedIn(team2.id)).toBe(false);
    expect(isSignedIn(team3.id)).toBe(true);
    expect(body.data.user.name).toBe(user.name);
    expect(body.data.team.name).toBe(team.name);
    expect(body.data.team.allowedDomains).toEqual([]);
  });

  it("should return a collaboration token for a session", async () => {
    const user = await buildUser();
    const res = await server.post("/api/auth.info", user);
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.collaborationToken).toBeTruthy();
  });

  it("should not return a collaboration token for an API key", async () => {
    const user = await buildUser();
    const key = await buildApiKey({ userId: user.id });
    const res = await server.post("/api/auth.info", {
      headers: {
        Authorization: `Bearer ${key.value}`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.collaborationToken).toBeUndefined();
  });

  it("should not return a collaboration token for an OAuth access token", async () => {
    const user = await buildUser();
    const authentication = await buildOAuthAuthentication({
      user,
      scope: [Scope.Read],
    });
    const res = await server.post("/api/auth.info", {
      headers: {
        Authorization: `Bearer ${authentication.accessToken}`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.collaborationToken).toBeUndefined();
  });

  it("should require the team to not be deleted", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    await team.destroy();
    const res = await server.post("/api/auth.info", user);
    expect(res.status).toEqual(401);
  });

  it("should omit other workspaces at the same URL on self-hosted installations", async () => {
    setSelfHosted();
    const team = await buildTeam();
    const team2 = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    await buildUser({
      teamId: team2.id,
      email: user.email,
    });

    const res = await server.post("/api/auth.info", user);
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.availableTeams.map((t: { id: string }) => t.id)).toEqual([
      team.id,
    ]);
  });

  it("should require authentication", async () => {
    const res = await server.post("/api/auth.info");
    expect(res.status).toEqual(401);
  });
});

describe("#auth.switchWorkspace", () => {
  const originalOperators = env.WORKSPACE_OPERATOR_USER_IDS;

  beforeEach(() => {
    setSelfHosted();
  });

  afterEach(() => {
    env.WORKSPACE_OPERATOR_USER_IDS = originalOperators;
  });

  function sessionCookie(
    user: User,
    expiresAt = new Date(Date.now() + 60_000)
  ) {
    return `accessToken=${user.getSessionToken(expiresAt, "oidc")}`;
  }

  function cookieHeaders(cookie: string) {
    const csrf = bundleToken(generateRawToken(16), env.SECRET_KEY);
    return {
      Cookie: `${cookie}; ${CSRF.cookieName}=${csrf}`,
      [CSRF.headerName]: csrf,
    };
  }

  function switchWorkspace(cookie: string, teamId: string, client = server) {
    return client.post("/api/auth.switchWorkspace", {
      body: { teamId },
      headers: cookieHeaders(cookie),
    });
  }

  function switchedCookie(
    response: Awaited<ReturnType<typeof switchWorkspace>>
  ) {
    expect(response.status).toEqual(200);
    const cookies = response.headers.raw()["set-cookie"];
    const cookie = cookies?.find((value) => value.startsWith("accessToken="));
    if (!cookie) {
      throw new Error("Expected a workspace session cookie");
    }
    return cookie.split(";")[0];
  }

  it("creates one admin per workspace and lets an operator continue switching", async () => {
    const operator = await buildUser();
    const otherOperator = await buildUser();
    const teamB = await buildTeam();
    const teamC = await buildTeam();
    env.WORKSPACE_OPERATOR_USER_IDS = [operator.id, otherOperator.id];

    const cookie = sessionCookie(operator);
    const info = await server.post("/api/auth.info", {
      headers: { Cookie: cookie },
    });
    const data = (await info.json()).data;
    expect(data.availableTeams).toEqual(
      expect.arrayContaining(
        [operator.teamId, teamB.id, teamC.id].map((id) =>
          expect.objectContaining({ id, canSwitchInPlace: true })
        )
      )
    );

    const requests = await Promise.all([
      switchWorkspace(cookie, teamB.id),
      switchWorkspace(cookie, teamB.id),
    ]);
    const [inB] = requests.map(switchedCookie);
    const b = await server.post("/api/auth.info", {
      headers: { Cookie: inB },
    });
    const bData = (await b.json()).data;
    expect(bData.team.id).toEqual(teamB.id);
    expect(bData.user.role).toEqual(UserRole.Admin);
    expect(bData.user.id).not.toEqual(operator.id);
    expect(
      await User.count({
        where: { workspaceAdminSourceId: operator.id, teamId: teamB.id },
      })
    ).toEqual(1);
    const events = await Event.findAll({
      where: {
        name: "users.switch_workspace",
        actorId: operator.id,
        teamId: teamB.id,
        userId: bData.user.id,
      },
    });
    expect(events).toHaveLength(2);
    expect(events.filter((event) => event.data?.mappingCreated)).toHaveLength(
      1
    );
    expect(events[0].data).toMatchObject({
      fromTeamId: operator.teamId,
      sourceTeamId: operator.teamId,
    });

    const inC = switchedCookie(await switchWorkspace(inB, teamC.id));
    const backInB = switchedCookie(await switchWorkspace(inC, teamB.id));
    const back = await server.post("/api/auth.info", {
      headers: { Cookie: backInB },
    });
    expect((await back.json()).data.user.id).toEqual(bData.user.id);

    const otherInB = switchedCookie(
      await switchWorkspace(sessionCookie(otherOperator), teamB.id)
    );
    const other = await server.post("/api/auth.info", {
      headers: { Cookie: otherInB },
    });
    const otherData = (await other.json()).data;
    expect(otherData.user.role).toEqual(UserRole.Admin);
    expect(otherData.user.id).not.toEqual(bData.user.id);

    const mapped = await User.findByPk(bData.user.id, { rejectOnEmpty: true });
    const unmarkedSession = await server.post("/api/auth.info", {
      headers: { Cookie: sessionCookie(mapped) },
    });
    expect(unmarkedSession.status).toEqual(401);

    env.WORKSPACE_OPERATOR_USER_IDS = [otherOperator.id];
    const revoked = await server.post("/api/auth.info", {
      headers: { Cookie: backInB },
    });
    expect(revoked.status).toEqual(401);
    expect(
      (await server.post("/api/auth.info", { headers: { Cookie: otherInB } }))
        .status
    ).toEqual(200);
  });

  it.each([
    [UserRole.Admin, false],
    [UserRole.Admin, true],
    [UserRole.Member, true],
  ] as const)(
    "restores the original %s (existing mapping: %s)",
    async (role, hasExistingMapping) => {
      const operator = await buildUser({ role });
      const otherTeam = await buildTeam();
      env.WORKSPACE_OPERATOR_USER_IDS = [operator.id];

      if (hasExistingMapping) {
        await buildAdmin({
          teamId: operator.teamId,
          workspaceAdminSourceId: operator.id,
          email: null,
        });
      }

      const away = switchedCookie(
        await switchWorkspace(sessionCookie(operator), otherTeam.id)
      );
      const atHome = switchedCookie(
        await switchWorkspace(away, operator.teamId)
      );
      const info = await server.post("/api/auth.info", {
        headers: { Cookie: atHome },
      });
      expect(info.status).toEqual(200);
      const data = (await info.json()).data;
      expect(data.team.id).toEqual(operator.teamId);
      expect(data.user).toMatchObject({
        id: operator.id,
        email: operator.email,
        role,
      });
      expect(
        await User.count({
          where: {
            teamId: operator.teamId,
            workspaceAdminSourceId: operator.id,
          },
          paranoid: false,
        })
      ).toEqual(hasExistingMapping ? 1 : 0);
    }
  );

  it.each(["source", "mapped", "sso"] as const)(
    "revokes the source and every mapped session after %s sign-out",
    async (reason) => {
      const operator = await buildAdmin();
      const teamB = await buildTeam();
      const teamC = await buildTeam();
      env.WORKSPACE_OPERATOR_USER_IDS = [operator.id];

      const expiresAt = new Date(Date.now() + 60_000);
      const sourceCookie = sessionCookie(operator, expiresAt);
      const inB = switchedCookie(await switchWorkspace(sourceCookie, teamB.id));
      const inC = switchedCookie(await switchWorkspace(inB, teamC.id));
      const info = await server.post("/api/auth.info", {
        headers: { Cookie: inC },
      });
      const { collaborationToken } = (await info.json()).data;
      expect(getJWTPayload(collaborationToken).expiresAt).toEqual(
        expiresAt.toISOString()
      );
      await expect(
        getUserForJWT(collaborationToken, ["collaboration"])
      ).resolves.toMatchObject({
        user: { teamId: teamC.id },
      });

      if (reason === "sso") {
        const provider = vi
          .spyOn(UserAuthentication.prototype, "validateAccess")
          .mockResolvedValue(false);
        try {
          await new ValidateSSOAccessTask().perform({ userId: operator.id });
        } finally {
          provider.mockRestore();
        }
      } else {
        const response = await server.post("/api/auth.delete", {
          headers: cookieHeaders(reason === "source" ? sourceCookie : inB),
        });
        expect(response.status).toEqual(200);
      }

      for (const cookie of [sourceCookie, inB, inC]) {
        const response = await server.post("/api/auth.info", {
          headers: { Cookie: cookie },
        });
        expect(response.status).toEqual(401);
      }
      await expect(
        getUserForJWT(collaborationToken, ["collaboration"])
      ).rejects.toThrow("Workspace operator access required");
    }
  );

  it("revalidates the original SSO account from a mapped session", async () => {
    const operator = await buildAdmin({
      lastSignedInAt: new Date(Date.now() - 7_200_000),
    });
    const target = await buildTeam();
    env.WORKSPACE_OPERATOR_USER_IDS = [operator.id];
    const schedule = vi.spyOn(ValidateSSOAccessTask.prototype, "schedule");
    try {
      const cookie = switchedCookie(
        await switchWorkspace(sessionCookie(operator), target.id)
      );
      expect(schedule).toHaveBeenCalledWith({ userId: operator.id });
      schedule.mockClear();

      const response = await server.post("/api/auth.info", {
        headers: { Cookie: cookie },
      });
      expect(response.status).toEqual(200);
      expect(schedule).toHaveBeenCalledWith({ userId: operator.id });
    } finally {
      schedule.mockRestore();
    }
  });

  it("repairs the original mapping ID if an older version removed it", async () => {
    const operator = await buildAdmin();
    const admin = await buildAdmin();
    const mapped = await buildUser({
      teamId: admin.teamId,
      workspaceAdminSourceId: operator.id,
      name: "Unknown",
      email: null,
      role: UserRole.Member,
      deletedAt: new Date(),
      suspendedAt: new Date(),
    });
    env.WORKSPACE_OPERATOR_USER_IDS = [operator.id];

    const cookie = switchedCookie(
      await switchWorkspace(sessionCookie(operator), admin.teamId)
    );
    const response = await server.post("/api/auth.info", {
      headers: { Cookie: cookie },
    });
    expect(response.status).toEqual(200);
    const { user } = (await response.json()).data;
    expect(user).toMatchObject({
      id: mapped.id,
      name: operator.name,
      role: UserRole.Admin,
    });
  });

  it("protects mapped accounts and the last active workspace administrator", async () => {
    const operator = await buildAdmin();
    const admin = await buildAdmin();
    const suspendedAdmin = await buildAdmin({
      teamId: admin.teamId,
      suspendedAt: new Date(),
    });
    env.WORKSPACE_OPERATOR_USER_IDS = [operator.id];

    const cookie = switchedCookie(
      await switchWorkspace(sessionCookie(operator), admin.teamId)
    );
    const info = await server.post("/api/auth.info", {
      headers: { Cookie: cookie },
    });
    const { user } = (await info.json()).data;
    for (const path of ["users.update_role", "users.suspend", "users.delete"]) {
      const response = await server.post(`/api/${path}`, admin, {
        body: {
          id: user.id,
          ...(path === "users.update_role" && { role: UserRole.Member }),
        },
      });
      expect(response.status).toEqual(403);
    }
    for (const path of ["users.update_role", "users.suspend", "users.delete"]) {
      const response = await server.post(`/api/${path}`, {
        headers: cookieHeaders(cookie),
        body: {
          id: admin.id,
          ...(path === "users.update_role" && { role: UserRole.Member }),
        },
      });
      expect(response.status).toEqual(400);
    }
    await admin.reload();
    expect(admin).toMatchObject({
      role: UserRole.Admin,
      suspendedAt: null,
      deletedAt: null,
    });
    expect(suspendedAdmin.isSuspended).toBe(true);
  });

  it("rejects new credentials on a mapped account", async () => {
    const operator = await buildAdmin();
    const team = await buildTeam({ passkeysEnabled: true });
    env.WORKSPACE_OPERATOR_USER_IDS = [operator.id];
    const cookie = switchedCookie(
      await switchWorkspace(sessionCookie(operator), team.id)
    );

    const apiKey = await server.post("/api/apiKeys.create", {
      headers: cookieHeaders(cookie),
      body: { name: "test-key" },
    });
    expect(apiKey.status).toEqual(403);
    const passkey = await server.post(
      "/auth/passkeys.generateRegistrationOptions",
      {
        headers: cookieHeaders(cookie),
      }
    );
    expect(passkey.status).toEqual(403);
  });

  it("uses the same switch rate limit across the original and mapped accounts", async () => {
    const operator = await buildAdmin();
    const otherTeam = await buildTeam();
    env.WORKSPACE_OPERATOR_USER_IDS = [operator.id];
    const originalEnabled = env.RATE_LIMITER_ENABLED;
    const originalMultiplier = env.RATE_LIMITER_MULTIPLIER;
    const path = RateLimiter.normalizePath("/api/auth.switchWorkspace");
    const app = new Koa();
    app.use(defaultRateLimiter());
    onerror(webService(app));
    const limitedServer = new TestServer(app);
    env.RATE_LIMITER_ENABLED = true;
    env.RATE_LIMITER_MULTIPLIER = 0.04;
    try {
      const cookie = switchedCookie(
        await switchWorkspace(
          sessionCookie(operator),
          otherTeam.id,
          limitedServer
        )
      );
      const limited = await switchWorkspace(
        cookie,
        operator.teamId,
        limitedServer
      );
      expect(limited.status).toEqual(429);
    } finally {
      env.RATE_LIMITER_ENABLED = originalEnabled;
      env.RATE_LIMITER_MULTIPLIER = originalMultiplier;
      RateLimiter.rateLimiterMap.delete(path);
      limitedServer.close();
    }
  });

  it("keeps the switch unavailable to an ordinary administrator or member", async () => {
    const operator = await buildUser();
    const target = await buildTeam();
    const admin = await buildAdmin();
    const member = await buildUser();
    env.WORKSPACE_OPERATOR_USER_IDS = [operator.id];

    for (const user of [admin, member]) {
      const cookie = sessionCookie(user);
      const info = await server.post("/api/auth.info", {
        headers: { Cookie: cookie },
      });
      expect((await info.json()).data.availableTeams).toEqual([
        expect.not.objectContaining({ canSwitchInPlace: true }),
      ]);
      expect((await switchWorkspace(cookie, target.id)).status).toEqual(403);
    }
  });
});

describe("#auth.delete", () => {
  it("should make the access token unusable", async () => {
    const user = await buildUser();
    const res = await server.post("/api/auth.delete", user);
    expect(res.status).toEqual(200);

    const res2 = await server.post("/api/auth.info", user);
    expect(res2.status).toEqual(401);
  });

  it("should require authentication", async () => {
    const res = await server.post("/api/auth.delete");
    expect(res.status).toEqual(401);
  });
});

describe("#auth.config", () => {
  it("should return available SSO providers", async () => {
    const res = await server.post("/api/auth.config");
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers.length).toBe(3);
    expect(body.data.providers[0].name).toBe("Slack");
    expect(body.data.providers[1].name).toBe("OpenID Connect");
    expect(body.data.providers[2].name).toBe("Google");
  });

  it("should return available providers for team subdomain", async () => {
    const subdomain = buildSubdomain();
    await buildTeam({
      guestSignin: false,
      subdomain,
      authenticationProviders: [
        {
          name: "slack",
          providerId: randomUUID(),
        },
      ],
    });
    const res = await server.post("/api/auth.config", {
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers.length).toBe(1);
    expect(body.data.providers[0].name).toBe("Slack");
  });

  it("should return available providers for team custom domain", async () => {
    const domain = faker.internet.domainName();
    await buildTeam({
      guestSignin: false,
      domain,
      authenticationProviders: [
        {
          name: "slack",
          providerId: randomUUID(),
        },
      ],
    });
    const res = await server.post("/api/auth.config", {
      headers: {
        host: domain,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers.length).toBe(1);
    expect(body.data.providers[0].name).toBe("Slack");
  });

  it("should return email provider for team when guest signin enabled", async () => {
    const subdomain = buildSubdomain();
    await buildTeam({
      guestSignin: true,
      subdomain,
      authenticationProviders: [
        {
          name: "slack",
          providerId: randomUUID(),
        },
      ],
    });
    const res = await server.post("/api/auth.config", {
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers.length).toBe(2);
    expect(body.data.providers[0].name).toBe("Slack");
    expect(body.data.providers[1].name).toBe("Email");
  });

  it("should not return provider when disabled", async () => {
    const subdomain = buildSubdomain();
    await buildTeam({
      guestSignin: false,
      subdomain,
      authenticationProviders: [
        {
          name: "slack",
          providerId: randomUUID(),
          enabled: false,
        },
      ],
    });
    const res = await server.post("/api/auth.config", {
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers.length).toBe(0);
  });

  it("should not return passkeys provider when passkeysEnabled but no passkeys exist", async () => {
    const subdomain = buildSubdomain();
    await buildTeam({
      guestSignin: false,
      passkeysEnabled: true,
      subdomain,
      authenticationProviders: [
        {
          name: "slack",
          providerId: randomUUID(),
        },
      ],
    });
    const res = await server.post("/api/auth.config", {
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers.length).toBe(1);
    expect(body.data.providers[0].name).toBe("Slack");
  });

  it("should return passkeys provider when passkeysEnabled and passkeys exist", async () => {
    const subdomain = buildSubdomain();
    const team = await buildTeam({
      guestSignin: false,
      passkeysEnabled: true,
      subdomain,
      authenticationProviders: [
        {
          name: "slack",
          providerId: randomUUID(),
        },
      ],
    });
    const user = await buildUser({ teamId: team.id });
    await buildUserPasskey({ userId: user.id });
    const res = await server.post("/api/auth.config", {
      headers: {
        host: `${subdomain}.outline.dev`,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.providers.length).toBe(2);
    expect(body.data.providers[0].name).toBe("Slack");
    expect(body.data.providers[1].name).toBe("Passkeys");
  });

  it("should not brand the login page with one of several self-hosted teams", async () => {
    setSelfHosted();
    const domain = faker.internet.domainName();
    await buildTeam({ domain, guestSignin: true });
    await buildTeam();

    const res = await server.post("/api/auth.config", {
      headers: {
        host: domain,
      },
    });
    const body = await res.json();
    expect(res.status).toEqual(200);
    expect(body.data.name).toBeUndefined();
    expect(
      body.data.providers.some((p: { id: string }) => p.id === "email")
    ).toBe(false);
    expect(body.data.providers.length).toBeGreaterThan(0);
  });

  // Self-hosted auth.config only brands a single team, but other test files create teams in parallel.
  // oxlint-disable-next-line vitest/no-disabled-tests
  describe.skip("self hosted", () => {
    beforeEach(setSelfHosted);

    it("should return all configured providers but respect email setting", async () => {
      await buildTeam({
        guestSignin: false,
        authenticationProviders: [
          {
            name: "slack",
            providerId: randomUUID(),
          },
        ],
      });
      const res = await server.post("/api/auth.config");
      const body = await res.json();
      expect(res.status).toEqual(200);
      expect(body.data.providers.length).toBe(3);
      expect(body.data.providers[0].name).toBe("Google");
      expect(body.data.providers[1].name).toBe("OpenID Connect");
      expect(body.data.providers[2].name).toBe("Slack");
    });

    it("should return email provider for team when guest signin enabled", async () => {
      await buildTeam({
        guestSignin: true,
        authenticationProviders: [
          {
            name: "slack",
            providerId: randomUUID(),
          },
        ],
      });
      const res = await server.post("/api/auth.config");
      const body = await res.json();
      expect(res.status).toEqual(200);
      expect(body.data.providers.length).toBe(4);
      expect(body.data.providers[0].name).toBe("Slack");
      expect(body.data.providers[1].name).toBe("OpenID Connect");
      expect(body.data.providers[2].name).toBe("Google");
      expect(body.data.providers[3].name).toBe("Email");
    });
  });
});
