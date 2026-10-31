import { describe, expect, it } from "vitest";

import { isJsonObject, withinJsonBudget, type JsonValue } from "../../src/protocols/json.js";

function nested(depth: number): JsonValue {
  let value: JsonValue = 0;
  for (let level = 0; level < depth; level += 1) {
    value = [value];
  }
  return value;
}

describe("shared JSON budget", (): void => {
  it("counts the root as depth 0 and every value as a node", (): void => {
    expect(withinJsonBudget(nested(3), { maxDepth: 3, maxNodes: 4 })).toBe(true);
    expect(withinJsonBudget(nested(4), { maxDepth: 3, maxNodes: 100 })).toBe(false);
    expect(withinJsonBudget(nested(3), { maxDepth: 10, maxNodes: 3 })).toBe(false);
    expect(withinJsonBudget({ a: [1, 2], b: null }, { maxDepth: 2, maxNodes: 5 })).toBe(true);
    expect(withinJsonBudget({ a: [1, 2], b: null }, { maxDepth: 2, maxNodes: 4 })).toBe(false);
  });

  it("stops at the depth limit without recursing through a very deep document", (): void => {
    expect(withinJsonBudget(nested(100_000), { maxDepth: 8, maxNodes: 1_000_000 })).toBe(false);
  });

  it("applies optional collection, key, and string limits only when given", (): void => {
    const document: JsonValue = { long: "x".repeat(10), items: [1, 2, 3] };
    const base = { maxDepth: 4, maxNodes: 100 };
    expect(withinJsonBudget(document, base)).toBe(true);
    expect(withinJsonBudget(document, { ...base, maxCollectionItems: 2 })).toBe(false);
    expect(withinJsonBudget(document, { ...base, maxKeyLength: 4 })).toBe(false);
    expect(withinJsonBudget(document, { ...base, maxStringLength: 9 })).toBe(false);
    expect(
      withinJsonBudget(document, {
        ...base,
        maxCollectionItems: 3,
        maxKeyLength: 5,
        maxStringLength: 10,
      }),
    ).toBe(true);
  });

  it("narrows only non-array objects", (): void => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject(undefined)).toBe(false);
  });
});
