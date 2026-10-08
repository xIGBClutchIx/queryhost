import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as root from "../../src/index.js";
import * as registry from "../../src/registry.js";

/** Value-level static and dynamic import specifiers; type-only imports never run. */
function importSpecifiers(source: string, includeDynamic = true): readonly string[] {
  const staticImports = source.matchAll(
    /^\s*(?:import|export)\s+(?!type\b)(?:[^;"']*?\sfrom\s+)?["']([^"']+)["']/gmu,
  );
  const dynamicImports = source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/gu);
  return [...staticImports, ...(includeDynamic ? dynamicImports : [])].map(
    (match) => match[1] ?? "",
  );
}

/** Follows relative imports from one source module and returns every bare specifier. */
function externalImports(
  entry: URL,
  includeDynamic = true,
  seen = new Set<string>(),
): readonly string[] {
  if (seen.has(entry.href)) return [];
  seen.add(entry.href);
  return importSpecifiers(readFileSync(entry, "utf8"), includeDynamic).flatMap((specifier) =>
    specifier.startsWith(".")
      ? externalImports(new URL(specifier.replace(/\.js$/u, ".ts"), entry), includeDynamic, seen)
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

  it("sees every import form that runs code", () => {
    expect(
      importSpecifiers(
        [
          'import "node:fs";',
          'import { lookup } from "node:dns";',
          'import * as net from "node:net";',
          'export { query } from "./index.js";',
          'export * from "./runtime/client.js";',
          'const wasm = await import("@foxglove/wasm-bz2");',
          'import type { GameId } from "./contracts/query.js";',
          'export type { GameId } from "./contracts/query.js";',
          'export const NAME = "queryhost";',
        ].join("\n"),
      ),
    ).toEqual([
      "node:fs",
      "node:dns",
      "node:net",
      "./index.js",
      "./runtime/client.js",
      "@foxglove/wasm-bz2",
    ]);
  });

  it("detects a runtime import in the root entry", () => {
    expect(externalImports(new URL("../../src/index.ts", import.meta.url))).toContain("node:net");
  });
});

describe("package-root entry", () => {
  it("defers the HTTP stacks and bzip2 decoder until a query needs them", () => {
    const eager = externalImports(new URL("../../src/index.ts", import.meta.url), false);
    expect(eager).toContain("node:net");
    expect(eager).not.toContain("node:http");
    expect(eager).not.toContain("node:https");
    expect(eager).not.toContain("@foxglove/wasm-bz2");
  });
});
