import { describe, expect, it } from "vitest";
import {
  childPath,
  indexJson,
  parseJson,
  searchJson,
  visibleRows,
  type JsonValue,
} from "../../src/web/lib/json.js";

const ORDER: JsonValue = {
  id: "order_8F2K",
  customer: { email: "lucia@example.com", "x-segment": "returning" },
  items: [
    { sku: "TSHIRT-BLK-M", qty: 2 },
    { sku: "MUG-WHT", qty: 1 },
    { sku: "CAP", qty: 1 },
    { sku: "SOCKS", tags: ["Gift"] },
  ],
  "shipping.address": { city: "Buenos Aires" },
  coupon: null,
};

describe("childPath (S8 path format)", () => {
  it("gives the root no prefix and the first identifier key no dot", () => {
    expect(childPath("", "customer")).toBe("customer");
  });

  it("joins identifier keys with a dot", () => {
    expect(childPath("customer", "email")).toBe("customer.email");
  });

  it("brackets non-identifier keys", () => {
    expect(childPath("customer", "x-segment")).toBe('customer["x-segment"]');
    expect(childPath("", "shipping.address")).toBe('["shipping.address"]');
    expect(childPath("a", "x.y")).toBe('a["x.y"]');
  });

  it("uses [n] for array indices", () => {
    expect(childPath("items", 3)).toBe("items[3]");
    expect(childPath(childPath(childPath("a", "b"), 3), "c")).toBe("a.b[3].c");
    expect(childPath("", 0)).toBe("[0]");
  });

  it("indexes the root as the empty path", () => {
    const index = indexJson(ORDER);
    expect(index.get("")?.key).toBeNull();
    expect(index.get("")?.parent).toBeNull();
    expect(index.has('["shipping.address"].city')).toBe(true);
    expect(index.has("items[3].tags[0]")).toBe(true);
  });
});

describe("searchJson", () => {
  const index = indexJson(ORDER);

  it("matches keys and values case-insensitively", () => {
    const { hits } = searchJson(index, "SKU");
    expect([...hits]).toEqual(["items[0].sku", "items[1].sku", "items[2].sku", "items[3].sku"]);
    expect([...searchJson(index, "buenos").hits]).toEqual(['["shipping.address"].city']);
    expect([...searchJson(index, "gift").hits]).toEqual(["items[3].tags[0]"]);
  });

  it("expands every ancestor of a hit, and nothing else", () => {
    const { expand } = searchJson(index, "gift");
    expect([...expand].sort()).toEqual(["", "items", "items[3]", "items[3].tags"].sort());
  });

  it("matches null and numbers as text, but not array indices", () => {
    expect([...searchJson(index, "null").hits]).toEqual(["coupon"]);
    expect(searchJson(index, "3").hits.has("items[3]")).toBe(false);
  });

  it("returns nothing for a blank query or no match", () => {
    expect(searchJson(index, "   ").hits.size).toBe(0);
    expect(searchJson(index, "zzz").hits.size).toBe(0);
  });

  it("search hits are the texts the shared highlighter marks (highlightParts moved to text.ts)", async () => {
    const { highlightParts } = await import("../../src/web/lib/text.js");
    expect([...searchJson(index, "mug").hits]).toEqual(["items[1].sku"]);
    expect(highlightParts("MUG-WHT", "mug")).toEqual([
      { text: "MUG", hit: true },
      { text: "-WHT", hit: false },
    ]);
    expect("highlightParts" in (await import("../../src/web/lib/json.js"))).toBe(false);
  });
});

describe("visibleRows", () => {
  it("hides the children of collapsed containers but always shows the root open", () => {
    const index = indexJson(ORDER);
    const rows = visibleRows(index, new Set(["", "items", "customer", '["shipping.address"]']));
    expect(rows.map((r) => r.node.path)).toEqual(["", "id", "customer", "items", '["shipping.address"]', "coupon"]);
    expect(rows[0]!.open).toBe(true);
  });
});

describe("parseJson", () => {
  it("reports the parser message for invalid JSON", () => {
    const result = parseJson("{ \"a\": }");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});
