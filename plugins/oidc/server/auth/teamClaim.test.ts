import env from "../env";
import { getTeamClaim } from "./teamClaim";

describe("getTeamClaim", () => {
  const originalTeamClaim = env.OIDC_TEAM_CLAIM;
  const originalTeamNameClaim = env.OIDC_TEAM_NAME_CLAIM;

  afterEach(() => {
    env.OIDC_TEAM_CLAIM = originalTeamClaim;
    env.OIDC_TEAM_NAME_CLAIM = originalTeamNameClaim;
  });

  it("should return undefined when the team claim is not configured", () => {
    env.OIDC_TEAM_CLAIM = undefined;

    expect(getTeamClaim({ org: "123" })).toBeUndefined();
  });

  it("should read the team claim from the first source that has it", () => {
    env.OIDC_TEAM_CLAIM = "org";
    env.OIDC_TEAM_NAME_CLAIM = "org_name";

    expect(
      getTeamClaim({ org: " 123 " }, { org: "456", org_name: "Payments" })
    ).toEqual({ externalId: "123", name: "Payments" });
  });

  it("should accept numeric claims", () => {
    env.OIDC_TEAM_CLAIM = "org";
    env.OIDC_TEAM_NAME_CLAIM = undefined;

    expect(getTeamClaim({ org: 42 })).toEqual({
      externalId: "42",
      name: undefined,
    });
  });

  it("should read nested claims", () => {
    env.OIDC_TEAM_CLAIM = "organization.id";

    expect(getTeamClaim({ organization: { id: "abc" } })?.externalId).toEqual(
      "abc"
    );
  });

  it("should read literal namespaced claims containing dots", () => {
    env.OIDC_TEAM_CLAIM = "https://neo-css-studio.example.com/OAOrgId";
    env.OIDC_TEAM_NAME_CLAIM = "https://neo-css-studio.example.com/OAOrgName";

    expect(
      getTeamClaim({
        "https://neo-css-studio.example.com/OAOrgId": "org-01",
        "https://neo-css-studio.example.com/OAOrgName": "研发一部",
      })
    ).toEqual({ externalId: "org-01", name: "研发一部" });
  });

  it("should truncate long team names", () => {
    env.OIDC_TEAM_CLAIM = "org";
    env.OIDC_TEAM_NAME_CLAIM = "org_name";

    expect(
      getTeamClaim({ org: "123", org_name: "a".repeat(300) })?.name
    ).toHaveLength(255);
  });

  it("should throw when the configured team claim is missing", () => {
    env.OIDC_TEAM_CLAIM = "org";

    expect(() => getTeamClaim({ org: "  " }, {})).toThrow(
      'A "org" field was not returned'
    );
  });

  it("should throw when the team claim is too long", () => {
    env.OIDC_TEAM_CLAIM = "org";

    expect(() => getTeamClaim({ org: "a".repeat(256) })).toThrow(
      "255 characters or less"
    );
  });
});
