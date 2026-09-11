import { describe, expect, it } from "vitest";

import worker from "../../worker/index";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function stubEnv(assetsFetch: (request: Request) => Promise<Response>): Env {
  return {
    ASSETS: { fetch: assetsFetch },
    SUPABASE_URL: "https://example.invalid",
    SUPABASE_ANON_KEY: "anon-placeholder",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-placeholder",
  };
}

const defaultAssets = (request: Request) => Promise.resolve(new Response("asset:" + new URL(request.url).pathname));

describe("Match worker default export", () => {
  it("redirects a legacy POST with a method-preserving 308 into the prefix, keeping the query", async () => {
    const env = stubEnv(defaultAssets);
    const response = await worker.fetch(
      new Request("https://gridwatchmatchweb.warsignallabs.net/api/score?x=1", { method: "POST" }),
      env,
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("Location")).toBe(
      "https://gridwatchmatchweb.warsignallabs.net/play/match/api/score?x=1",
    );
  });

  it("redirects a legacy GET with a 301 into the prefix, keeping the query", async () => {
    const env = stubEnv(defaultAssets);
    const response = await worker.fetch(
      new Request("https://gridwatchmatchweb.warsignallabs.net/?level=2", { method: "GET" }),
      env,
    );

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("https://gridwatchmatchweb.warsignallabs.net/play/match/?level=2");
  });

  it("rejects a non-POST to the score endpoint with 405", async () => {
    const env = stubEnv(defaultAssets);
    const response = await worker.fetch(new Request("https://gridwatchmatchweb.warsignallabs.net/play/match/api/score"), env);

    expect(response.status).toBe(405);
  });

  it("serves an asset with the prefix stripped", async () => {
    const env = stubEnv(defaultAssets);
    const response = await worker.fetch(
      new Request("https://gridwatchmatchweb.warsignallabs.net/play/match/assets/app.js"),
      env,
    );

    expect(await response.text()).toBe("asset:/assets/app.js");
  });

  it("rewrites an ASSETS redirect's Location back into the prefix", async () => {
    const env = stubEnv(() => Promise.resolve(new Response(null, { status: 301, headers: { Location: "/" } })));
    const response = await worker.fetch(
      new Request("https://gridwatchmatchweb.warsignallabs.net/play/match/legacy"),
      env,
    );

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/play/match/");
  });
});
