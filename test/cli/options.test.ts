import { describe, expect, it } from "vitest";

import { parseQueryArguments } from "../../src/cli/options.js";

const INVALID_ARGUMENT_CASES: readonly (readonly [readonly string[], string])[] = [
  [[], "Expected a game"],
  [["rust"], "Expected a game"],
  [["counter-strike", "play.example.com"], "Unsupported game"],
  [["rust", "play.example.com", "0"], "Port must be between"],
  [["rust", "play.example.com", "1.5"], "Port must be a whole number"],
  [["rust", "play.example.com", "--mode", "quick"], "--mode must be"],
  [["rust", "play.example.com", "--timeout", "30001"], "Timeout must be between"],
  [["rust", "play.example.com", "--query-port"], "--query-port requires"],
  [["rust", "play.example.com", "--json"], "Unsupported option"],
  [["rust", "play.example.com", "--mode", "full", "--mode", "summary"], "--mode may only"],
];

describe("query command arguments", (): void => {
  it("parses the short game, host, and port form", (): void => {
    expect(parseQueryArguments(["rust", "play.example.com", "28015"])).toEqual({
      kind: "query",
      options: { game: "rust", host: "play.example.com", port: 28_015 },
    });
  });

  it("parses flags independently from positional argument order", (): void => {
    expect(
      parseQueryArguments([
        "--mode",
        "summary",
        "rust",
        "[2606:4700:4700::1111]",
        "--timeout",
        "3000",
        "--query-port",
        "28016",
      ]),
    ).toEqual({
      kind: "query",
      options: {
        game: "rust",
        host: "[2606:4700:4700::1111]",
        mode: "summary",
        timeoutMs: 3_000,
        queryPort: 28_016,
      },
    });
  });

  it("accepts the canonical Satisfactory profile and optional custom port", (): void => {
    expect(parseQueryArguments(["satisfactory", "play.example.com", "17777"])).toEqual({
      kind: "query",
      options: { game: "satisfactory", host: "play.example.com", port: 17_777 },
    });
  });

  it.each([
    ["dst", "dont-starve-together"],
    ["zomboid", "project-zomboid"],
    ["7dtd", "7-days-to-die"],
    ["minecraft", "minecraft-java"],
    ["mcbe", "minecraft-bedrock"],
    ["five-m", "fivem"],
    ["red-m", "redm"],
    ["rdr3", "redm"],
    ["vs", "vintage-story"],
    ["cs2", "counter-strike-2"],
    ["css", "counter-strike-source"],
    ["tf2", "team-fortress-2"],
    ["l4d", "left-4-dead"],
    ["l4d2", "left-4-dead-2"],
    ["gmod", "garrys-mod"],
    ["ark", "ark-survival-evolved"],
    ["conan", "conan-exiles"],
    ["kf2", "killing-floor-2"],
    ["sotf", "sons-of-the-forest"],
    ["abioticfactor", "abiotic-factor"],
    ["a3", "arma-3"],
    ["ats", "american-truck-simulator"],
    ["ets2", "euro-truck-simulator-2"],
    ["sandstorm", "insurgency-sandstorm"],
  ] as const)("normalizes the %s alias", (alias, game): void => {
    expect(parseQueryArguments([alias, "play.example.com"])).toEqual({
      kind: "query",
      options: { game, host: "play.example.com" },
    });
  });

  it.each([["--help"], ["-h"], ["rust", "play.example.com", "--help"]])(
    "recognizes help without querying",
    (...args): void => {
      expect(parseQueryArguments(args)).toEqual({ kind: "help" });
    },
  );

  it.each(INVALID_ARGUMENT_CASES)("rejects malformed command arguments", (args, message): void => {
    const result = parseQueryArguments(args);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain(message);
    }
  });
});
