import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import Koa from "koa";
import env from "@server/env";
import { buildShare, buildTeam } from "@server/test/factories";
import { setSelfHosted } from "@server/test/support";
import { getTeamFromContext } from "./passport";

function buildContext(url: string) {
  const { host, pathname, search } = new URL(url);
  const req = new IncomingMessage(new Socket());
  req.method = "GET";
  req.url = pathname + search;
  req.headers = { host };
  return new Koa().createContext(req, new ServerResponse(req));
}

describe("getTeamFromContext", () => {
  it("should return null when self-hosted has multiple teams", async () => {
    setSelfHosted();
    await buildTeam();
    await buildTeam();

    const originalEnvironment = env.ENVIRONMENT;
    env.ENVIRONMENT = "production";
    try {
      const ctx = buildContext(env.URL);
      const team = await getTeamFromContext(ctx, { includeOAuthState: false });
      expect(team).toBeNull();
    } finally {
      env.ENVIRONMENT = originalEnvironment;
    }
  });

  it("should resolve team from rootShare on self-hosted installations", async () => {
    setSelfHosted();
    const team = await buildTeam();
    await buildTeam();
    const share = await buildShare({ teamId: team.id });

    const ctx = buildContext(env.URL);
    ctx.state.rootShare = share;

    const resolved = await getTeamFromContext(ctx, {
      includeOAuthState: false,
    });
    expect(resolved?.id).toEqual(team.id);
  });
});
