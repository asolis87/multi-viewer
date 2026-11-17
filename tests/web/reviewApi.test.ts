import { afterEach, describe, expect, it, vi } from "vitest";
import { postReview } from "../../src/web/lib/api.js";

afterEach(() => vi.unstubAllGlobals());

describe("postReview (S17 server contract)", () => {
  it("POSTs the submission as JSON to /api/review with the token", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const body = { decision: "approved" as const, comments: [] };
    expect(await postReview("a b", body)).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/review?t=a%20b");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("reports the server's { error } with the status, or a generic message", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "comments: text is blank" }), { status: 400 }));
    expect(await postReview("t", { decision: "approved", comments: [] })).toEqual({ ok: false, status: 400, error: "comments: text is blank" });
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 409 }));
    expect(await postReview("t", { decision: "approved", comments: [] })).toEqual({ ok: false, status: 409, error: "The server answered 409." });
    vi.stubGlobal("fetch", async () => Promise.reject(new TypeError("network")));
    expect(await postReview("t", { decision: "approved", comments: [] })).toMatchObject({ ok: false, status: 0 });
  });
});
