import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as root from "../../src/index.js";
import * as registry from "../../src/registry.js";

/** Follows relative value imports from one source module and returns every bare specifier. */
function externalImports(entry: URL, seen = new Set<string>()): readonly string[] {
  if (seen.has(entry.href)) return [];
  seen.add(entry.href);
  const source = readFileSync(entry, "utf8");
  const specifiers = [
    ...source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gmu),
  ].map((match) => match[1] ?? "");
  return specifiers.flatMap((specifier) =>
    specifier.startsWith(".")
      ? externalImports(new URL(specifier.replace(/\.js$/u, ".ts"), entry), seen)
      : [specifier],
  );
}

describe("queryhost/registry entry", () => {
  it("re-exports the root registry values unchanged", () => {
    expect(Object.keys(registry).sort()).toEqual([
      "GAME_ALIASES",
      "GAME_IDS",
      "GAME_REGISTRY",
      "canonicalGameId",
      "getGameDefinition",
      "isGameAlias",
      "isGameId",
      "isGameInputId",
      "listGames",
    ]);
    expect(registry.GAME_REGISTRY).toBe(root.GAME_REGISTRY);
    expect(registry.listGames).toBe(root.listGames);
  });

  it("imports no runtime modules, so browsers can bundle it", () => {
    expect(externalImports(new URL("../../src/registry.ts", import.meta.url))).toEqual([]);
  });
});
