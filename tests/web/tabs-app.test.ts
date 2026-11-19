import { afterEach, describe, expect, it } from "vitest";
import { fetchDoc } from "../../src/web/lib/api.js";

/**
 * The session (S1–S4, L8) must leave the shared single-document page untouched:
 * standalone viewers and review pages keep the plain `/api/doc` route, its messages and its
 * document shape. These are the legacy checks that still guard the shared frontend.
 */

const realFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit | undefined }[] = [];

function respond(body: unknown, status = 200): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": typeof body === "string" ? "text/plain" : "application/json" },
    });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  calls = [];
});

describe("shared legacy behavior (S4, L8)", () => {
  it("the plain document route is still the initial document: one GET, no tab id", async () => {
    globalThis.fetch = respond({ name: "plan.md", type: "markdown", content: "# plan", source: "file" });
    const result = await fetchDoc("tok");
    expect(result).toMatchObject({ ok: true, doc: { name: "plan.md", content: "# plan" } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/doc?t=tok");
    expect(calls[0].init?.method ?? "GET").toBe("GET");
  });

  it("a review document keeps its review flag on the same route", async () => {
    globalThis.fetch = respond({ name: "plan.md", type: "markdown", content: "# plan", source: "file", review: true });
    const result = await fetchDoc("tok");
    expect(result.ok && result.doc.review).toBe(true);
  });

  it("a 403 keeps the token message", async () => {
    globalThis.fetch = respond("Forbidden", 403);
    expect(await fetchDoc("tok")).toEqual({
      ok: false,
      status: 403,
      error: "This page needs the link printed by mview (the access token is missing or wrong).",
    });
  });

  it("no server keeps the offline message", async () => {
    globalThis.fetch = (async () => Promise.reject(new Error("offline"))) as typeof fetch;
    expect(await fetchDoc("tok")).toEqual({
      ok: false,
      status: 0,
      error: "Can’t reach the mview server. Is the command still running?",
    });
  });

  it("a 500 keeps the server's message", async () => {
    globalThis.fetch = respond({ error: "README.md could not be read." }, 500);
    expect(await fetchDoc("tok")).toEqual({ ok: false, status: 500, error: "README.md could not be read." });
  });
});
