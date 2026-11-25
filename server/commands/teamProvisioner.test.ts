import { faker } from "@faker-js/faker";
import { randomUUID } from "node:crypto";
import { Team } from "@server/models";
import TeamDomain from "@server/models/TeamDomain";
import { buildTeam, buildUser, buildSubdomain } from "@server/test/factories";
import { setSelfHosted } from "@server/test/support";
import teamProvisioner from "./teamProvisioner";
import { createContext } from "@server/context";

describe("teamProvisioner", () => {
  const ip = faker.internet.ip();
  const ctx = createContext({ ip });

  describe("hosted", () => {
    it("should create team and authentication provider", async () => {
      const subdomain = buildSubdomain();
      const result = await teamProvisioner(ctx, {
        name: "Test team",
        subdomain,
        avatarUrl: faker.image.avatar(),
        authenticationProvider: {
          name: "google",
          providerId: `${subdomain}.com`,
        },
      });
      const { team, authenticationProvider, isNewTeam } = result;
      expect(authenticationProvider.name).toEqual("google");
      expect(authenticationProvider.providerId).toEqual(`${subdomain}.com`);
      expect(team.name).toEqual("Test team");
      expect(team.subdomain).toEqual(subdomain);
      expect(isNewTeam).toEqual(true);
    });

    it("should set subdomain append if unavailable", async () => {
      const subdomain = buildSubdomain();

      await buildTeam({
        subdomain,
      });

      const result = await teamProvisioner(ctx, {
        name: "Test team",
        subdomain,
        avatarUrl: faker.image.avatar(),
        authenticationProvider: {
          name: "google",
          providerId: `${subdomain}.com`,
        },
      });

      expect(result.isNewTeam).toEqual(true);
      expect(result.team.subdomain).toEqual(`${subdomain}1`);
    });

    it("should increment subdomain append if unavailable", async () => {
      const subdomain = buildSubdomain();
      await buildTeam({
        subdomain,
      });
      await buildTeam({
        subdomain: `${subdomain}1`,
      });
      const result = await teamProvisioner(ctx, {
        name: "Test team",
        subdomain,
        avatarUrl: faker.image.avatar(),
        authenticationProvider: {
          name: "google",
          providerId: `${subdomain}.com`,
        },
      });

      expect(result.team.subdomain).toEqual(`${subdomain}2`);
    });

    it("should return existing team", async () => {
      const subdomain = buildSubdomain();
      const authenticationProvider = {
        name: "google",
        providerId: `${subdomain}.com`,
      };
      const existing = await buildTeam({
        subdomain,
        authenticationProviders: [authenticationProvider],
      });
      const result = await teamProvisioner(ctx, {
        name: faker.company.name(),
        subdomain,
        authenticationProvider,
      });
      const { team, isNewTeam } = result;
      expect(team.id).toEqual(existing.id);
      expect(team.name).toEqual(existing.name);
      expect(team.subdomain).toEqual(subdomain);
      expect(isNewTeam).toEqual(false);
    });

    it("should return non-deleted team if multiple matches", async () => {
      const subdomain = buildSubdomain();
      const authenticationProvider = {
        name: "google",
        providerId: `${subdomain}.com`,
      };
      await buildTeam({
        subdomain: undefined,
        deletedAt: new Date(),
        authenticationProviders: [authenticationProvider],
      });
      const notDeleted = await buildTeam({
        subdomain: undefined,
        authenticationProviders: [authenticationProvider],
      });
      await buildTeam({
        subdomain: undefined,
        deletedAt: new Date(),
        authenticationProviders: [authenticationProvider],
      });
      const result = await teamProvisioner(ctx, {
        name: faker.company.name(),
        subdomain,
        authenticationProvider,
      });
      const { team, isNewTeam } = result;
      expect(team.id).toEqual(notDeleted.id);
      expect(isNewTeam).toEqual(false);
    });

    it("should error on mismatched team and authentication provider", async () => {
      const subdomain = buildSubdomain();

      const exampleTeam = await buildTeam({
        subdomain,
        authenticationProviders: [
          {
            name: "google",
            providerId: `${subdomain}.com`,
          },
        ],
      });

      let error;
      try {
        const testSubdomain = buildSubdomain();
        await teamProvisioner(ctx, {
          teamId: exampleTeam.id,
          name: "name",
          subdomain: testSubdomain,
          authenticationProvider: {
            name: "google",
            providerId: `${testSubdomain}.com`,
          },
        });
      } catch (e) {
        error = e;
      }
      expect(
        error instanceof Error && "id" in error ? error.id : undefined
      ).toEqual("invalid_authentication");
    });
  });

  describe("self hosted", () => {
    beforeEach(setSelfHosted);

    it("should allow creating first team", async () => {
      const subdomain = buildSubdomain();
      const { team, isNewTeam } = await teamProvisioner(ctx, {
        name: "Test team",
        subdomain,
        avatarUrl: faker.image.avatar(),
        authenticationProvider: {
          name: "google",
          providerId: `${subdomain}.com`,
        },
      });

      expect(isNewTeam).toBeTruthy();
      expect(team.name).toEqual("Test team");
    });

    it("should not allow creating multiple teams in installation", async () => {
      const team = await buildTeam();
      const subdomain = buildSubdomain();
      let error;

      try {
        await teamProvisioner(ctx, {
          name: "Test team",
          subdomain,
          avatarUrl: faker.image.avatar(),
          teamId: team.id,
          authenticationProvider: {
            name: "google",
            providerId: `${subdomain}.com`,
          },
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeTruthy();
    });

    it("should return existing team when within allowed domains", async () => {
      const domain = faker.internet.domainName();
      const existing = await buildTeam();
      const user = await buildUser({
        teamId: existing.id,
      });
      await TeamDomain.create({
        teamId: existing.id,
        name: domain,
        createdById: user.id,
      });
      const result = await teamProvisioner(ctx, {
        name: "Updated name",
        subdomain: buildSubdomain(),
        domain,
        teamId: existing.id,
        authenticationProvider: {
          name: "google",
          providerId: domain,
        },
      });
      const { team, authenticationProvider, isNewTeam } = result;
      expect(team.id).toEqual(existing.id);
      expect(team.name).toEqual(existing.name);
      expect(authenticationProvider.name).toEqual("google");
      expect(authenticationProvider.providerId).toEqual(domain);
      expect(isNewTeam).toEqual(false);
      const providers = await team.$get("authenticationProviders");
      expect(providers.length).toEqual(2);
    });

    it("should error when NOT within allowed domains", async () => {
      const existing = await buildTeam();
      const user = await buildUser({
        teamId: existing.id,
      });
      const allowedDomain = faker.internet.domainName();
      const otherDomain = faker.internet.domainName();
      await TeamDomain.create({
        teamId: existing.id,
        name: allowedDomain,
        createdById: user.id,
      });

      let error;
      try {
        await teamProvisioner(ctx, {
          name: "Updated name",
          subdomain: buildSubdomain(),
          domain: otherDomain,
          teamId: existing.id,
          authenticationProvider: {
            name: "google",
            providerId: otherDomain,
          },
        });
      } catch (err) {
        error = err;
      }

      expect(error).toBeTruthy();
    });

    it("should return existing team", async () => {
      const authenticationProvider = {
        name: "google",
        providerId: faker.internet.domainName(),
      };
      const subdomain = buildSubdomain();
      const existing = await buildTeam({
        subdomain,
        authenticationProviders: [authenticationProvider],
      });
      const result = await teamProvisioner(ctx, {
        name: "Updated name",
        subdomain,
        authenticationProvider,
      });
      const { team, isNewTeam } = result;
      expect(team.id).toEqual(existing.id);
      expect(team.name).toEqual(existing.name);
      expect(team.subdomain).toEqual(subdomain);
      expect(isNewTeam).toEqual(false);
    });
  });

  describe("external id", () => {
    beforeEach(setSelfHosted);

    const buildProvider = () => ({
      name: "oidc",
      providerId: faker.internet.domainName(),
    });

    it("should create a team for a new external id", async () => {
      await buildTeam();
      const externalId = randomUUID();
      const authenticationProvider = buildProvider();

      const result = await teamProvisioner(ctx, {
        externalId,
        name: "Org team",
        subdomain: buildSubdomain(),
        authenticationProvider,
      });

      expect(result.isNewTeam).toEqual(true);
      expect(result.team.externalId).toEqual(externalId);
      expect(result.team.name).toEqual("Org team");
      expect(result.authenticationProvider.providerId).toEqual(
        authenticationProvider.providerId
      );
    });

    it("should return the team matching the external id", async () => {
      const externalId = randomUUID();
      const authenticationProvider = buildProvider();
      const existing = await buildTeam({
        externalId,
        authenticationProviders: [authenticationProvider],
      });
      await buildTeam({ authenticationProviders: [authenticationProvider] });

      const result = await teamProvisioner(ctx, {
        externalId,
        name: "Updated name",
        subdomain: buildSubdomain(),
        authenticationProvider,
      });

      expect(result.isNewTeam).toEqual(false);
      expect(result.team.id).toEqual(existing.id);
      expect(result.team.name).toEqual(existing.name);
    });

    it("should create separate teams for different external ids sharing a provider", async () => {
      const authenticationProvider = buildProvider();

      const first = await teamProvisioner(ctx, {
        externalId: randomUUID(),
        name: "First",
        subdomain: buildSubdomain(),
        authenticationProvider,
      });
      const second = await teamProvisioner(ctx, {
        externalId: randomUUID(),
        name: "Second",
        subdomain: buildSubdomain(),
        authenticationProvider,
      });

      expect(first.isNewTeam).toEqual(true);
      expect(second.isNewTeam).toEqual(true);
      expect(second.team.id).not.toEqual(first.team.id);
    });

    it("should ignore the team from the request", async () => {
      const requestTeam = await buildTeam();
      const externalId = randomUUID();

      const result = await teamProvisioner(ctx, {
        teamId: requestTeam.id,
        externalId,
        name: "Org team",
        subdomain: buildSubdomain(),
        authenticationProvider: buildProvider(),
      });

      expect(result.team.id).not.toEqual(requestTeam.id);
      expect(result.team.externalId).toEqual(externalId);
    });

    it("should link the provider to an existing team without it", async () => {
      const externalId = randomUUID();
      const existing = await buildTeam({ externalId });
      const authenticationProvider = buildProvider();

      const result = await teamProvisioner(ctx, {
        externalId,
        name: "Org team",
        subdomain: buildSubdomain(),
        authenticationProvider,
      });

      expect(result.team.id).toEqual(existing.id);
      expect(result.authenticationProvider.teamId).toEqual(existing.id);
      expect(result.authenticationProvider.providerId).toEqual(
        authenticationProvider.providerId
      );
    });

    it("should create a single team for concurrent sign-ins", async () => {
      const externalId = randomUUID();
      const authenticationProvider = buildProvider();
      const provision = () =>
        teamProvisioner(ctx, {
          externalId,
          name: "Org team",
          subdomain: buildSubdomain(),
          authenticationProvider,
        });

      const results = await Promise.all([provision(), provision()]);

      expect(results[0].team.id).toEqual(results[1].team.id);
      expect(results.filter((result) => result.isNewTeam).length).toEqual(1);
      expect(await Team.count({ where: { externalId } })).toEqual(1);
    });

    it("should error when the matching team is deleted", async () => {
      const externalId = randomUUID();
      const existing = await buildTeam({ externalId });
      await existing.destroy();

      await expect(
        teamProvisioner(ctx, {
          externalId,
          name: "Org team",
          subdomain: buildSubdomain(),
          authenticationProvider: buildProvider(),
        })
      ).rejects.toMatchObject({ id: "pending_deletion" });
    });
  });
});
