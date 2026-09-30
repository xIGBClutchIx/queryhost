import { describe, expect, it, vi } from "vitest";

import type { A2sExchangeDependencies } from "../../src/protocols/a2s/network.js";
import { queryWithDependencies } from "../../src/runtime/client.js";
import {
  UdpTransportError,
  type UdpCollectionOptions,
  type UdpCollectionResult,
} from "../../src/transports/udp.js";
import { dependencies, fixtureA2s, packetType } from "../helpers/a2s-profile.js";

const EXPECTED_SERVER = {
  name: "QueryHost Steam Fixture",
  map: "TheIsland",
  version: "1.0.0.0",
  password: false,
  players: { online: 2, max: 70 },
  queryRttMs: 8,
};

const EXPECTED_INFO_DATA = {
  folder: "ark_survival_evolved",
  bots: 0,
  serverType: "dedicated",
  environment: "windows",
  vac: false,
  // The Info App ID field is 16 bits wide, so ARK's 346110 arrives truncated.
  appId: 18_430,
  tags: ["pve", "crossplay"],
};

const EXPECTED_PLAYERS = [
  { index: 0, name: "Survivor", score: 0, durationSeconds: 1800 },
  { index: 1, name: "", score: 0, durationSeconds: 42.5 },
];

const EXPECTED_RULES = { SESSIONFLAGS: "683", ServerPassword_b: "false" };

/** Canonical ID, one accepted alias or the ID itself, game port, and fixed Steam query port. */
const PLAYER_GAMES = [
  ["ark-survival-evolved", "ark", 7777, 27_015],
  ["killing-floor-2", "kf2", 7777, 27_015],
  ["day-of-dragons", "dayofdragons", 7777, 27_015],
  ["sons-of-the-forest", "sotf", 8766, 27_016],
  ["icarus", "icarus", 17_777, 27_015],
  ["abiotic-factor", "abioticfactor", 7777, 27_015],
] as const;

async function recordPorts(
  input: Parameters<typeof queryWithDependencies>[0][],
): Promise<readonly number[]> {
  const base = await fixtureA2s("steam-query-port");
  const ports: number[] = [];
  const a2s: A2sExchangeDependencies = {
    collect(options): Promise<UdpCollectionResult> {
      ports.push(options.target.port);
      return base.collect(options);
    },
  };
  for (const query of input) {
    await queryWithDependencies(query, dependencies(a2s));
  }
  return ports;
}

describe.each(PLAYER_GAMES)("%s game profile", (game, alias, gamePort, queryPort): void => {
  it("merges Info, Player, and raw Rules from the Steam query port", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: alias, host: "play.example.com" },
      dependencies(await fixtureA2s("steam-query-port")),
    );

    expect(result).toEqual({
      ok: true,
      game,
      server: EXPECTED_SERVER,
      data: { ...EXPECTED_INFO_DATA, players: EXPECTED_PLAYERS },
      rawData: { rules: EXPECTED_RULES },
      sources: [
        { source: "a2s-info", status: "ok", rttMs: 8 },
        { source: "a2s-player", status: "ok", rttMs: 5 },
        { source: "a2s-rules", status: "ok", rttMs: 6 },
      ],
      partial: false,
      warnings: [],
      durationMs: 25,
    });
  });

  it("keeps the query port fixed when the game port changes", async (): Promise<void> => {
    const ports = await recordPorts([
      { game, host: "play.example.com", mode: "summary" },
      { game, host: "play.example.com", port: gamePort + 100, mode: "summary" },
      { game, host: "play.example.com", queryPort: 28_000, mode: "summary" },
    ]);

    expect(ports).toEqual([queryPort, queryPort, 28_000]);
  });
});

describe("conan-exiles game profile", (): void => {
  it("reports Player as unsupported without querying it", async (): Promise<void> => {
    const base = await fixtureA2s("steam-query-port");
    const collect = vi.fn((options: UdpCollectionOptions) => base.collect(options));
    const result = await queryWithDependencies(
      { game: "conan", host: "play.example.com" },
      dependencies({ collect }),
    );

    expect(result).toEqual({
      ok: true,
      game: "conan-exiles",
      server: EXPECTED_SERVER,
      data: EXPECTED_INFO_DATA,
      rawData: { rules: EXPECTED_RULES },
      sources: [
        { source: "a2s-info", status: "ok", rttMs: 8 },
        { source: "a2s-player", status: "unsupported" },
        { source: "a2s-rules", status: "ok", rttMs: 6 },
      ],
      partial: false,
      warnings: [],
      durationMs: 25,
    });
    expect(collect.mock.calls.map(([options]) => packetType(options))).toEqual([0x54, 0x56]);
  });

  it("uses fixed Steam query port 27015", async (): Promise<void> => {
    const ports = await recordPorts([
      { game: "conan-exiles", host: "play.example.com", mode: "summary" },
      { game: "conan-exiles", host: "play.example.com", port: 7800, mode: "summary" },
    ]);

    expect(ports).toEqual([27_015, 27_015]);
  });
});

describe("soulmask game profile", (): void => {
  it("replaces the placeholder Info version with the NO_s rule", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "soulmask", host: "play.example.com" },
      dependencies(await fixtureA2s("soulmask")),
    );

    expect(result).toMatchObject({
      ok: true,
      game: "soulmask",
      server: {
        name: "QueryHost Soulmask Fixture",
        map: "Level01_Main",
        version: "1.3.2.7",
        players: { online: 1, max: 50 },
      },
      data: {
        folder: "WS",
        tags: ["pve"],
        players: [{ index: 0, name: "Chieftain", score: 0, durationSeconds: 300 }],
      },
      rawData: { rules: { NO_s: "1.3.2.7", PVP_b: "false" } },
      partial: false,
    });
  });

  it("keeps the Info version when Rules is unavailable", async (): Promise<void> => {
    const base = await fixtureA2s("soulmask");
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        return packetType(options) === 0x56
          ? Promise.reject(new UdpTransportError("TIMEOUT"))
          : base.collect(options);
      },
    };
    const result = await queryWithDependencies(
      { game: "soulmask", host: "play.example.com" },
      dependencies(a2s),
    );

    expect(result).toMatchObject({
      ok: true,
      game: "soulmask",
      server: { version: "1.0.0.0" },
      partial: true,
      warnings: [
        {
          code: "PARTIAL_RESULT",
          message: "One or more optional Soulmask query sources did not complete successfully.",
        },
        { code: "SOURCE_TIMEOUT", source: "a2s-rules" },
      ],
    });
    if (!result.ok) {
      throw new Error("Expected a successful Soulmask result.");
    }
    expect(result.rawData).toBeUndefined();
  });

  it("uses game port 8777 with fixed Steam query port 27015", async (): Promise<void> => {
    const ports = await recordPorts([
      { game: "soulmask", host: "play.example.com", mode: "summary" },
      { game: "soulmask", host: "play.example.com", port: 8800, mode: "summary" },
    ]);

    expect(ports).toEqual([27_015, 27_015]);
  });
});
