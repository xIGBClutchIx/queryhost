import { describe, expect, it } from "vitest";

import type { A2sExchangeDependencies } from "../../src/protocols/a2s/network.js";
import { queryWithDependencies } from "../../src/runtime/client.js";
import { UdpTransportError, type UdpCollectionResult } from "../../src/transports/udp.js";
import { dependencies, fixtureA2s, packetType } from "../helpers/a2s-profile.js";

const SOURCE_ENGINE_GAMES = [
  ["counter-strike-2", "cs2", "Counter-Strike 2"],
  ["counter-strike-source", "css", "Counter-Strike: Source"],
  ["team-fortress-2", "tf2", "Team Fortress 2"],
  ["left-4-dead", "l4d", "Left 4 Dead"],
  ["left-4-dead-2", "l4d2", "Left 4 Dead 2"],
  ["garrys-mod", "gmod", "Garry's Mod"],
] as const;

describe.each(SOURCE_ENGINE_GAMES)("%s game profile", (game, alias, gameName): void => {
  it("merges Info, Player, and raw Rules from the game port", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: alias, host: "play.example.com" },
      dependencies(await fixtureA2s("source-engine")),
    );

    expect(result).toEqual({
      ok: true,
      game,
      server: {
        name: "QueryHost Source Fixture",
        map: "cp_badlands",
        version: "9540945",
        password: false,
        players: { online: 3, max: 24 },
        queryRttMs: 8,
      },
      data: {
        game: "Team Fortress",
        folder: "tf",
        bots: 1,
        serverType: "dedicated",
        environment: "linux",
        vac: true,
        appId: 440,
        gamePort: 27_015,
        tags: ["alltalk", "payload", "increased_maxplayers"],
        sourceTv: { port: 27_020, name: "QueryHost TV" },
        players: [
          { index: 0, name: "Alice", score: 12, durationSeconds: 640.5 },
          { index: 1, name: "Bob", score: 0, durationSeconds: 31.25 },
          { index: 2, name: "", score: 3, durationSeconds: 5 },
        ],
      },
      rawData: {
        rules: {
          mp_timelimit: "30",
          sv_tags: "alltalk,payload",
          tf_gamemode_payload: "1",
        },
      },
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

  it("names the game in warnings when an optional source fails", async (): Promise<void> => {
    const base = await fixtureA2s("source-engine");
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        return packetType(options) === 0x56
          ? Promise.reject(new UdpTransportError("TIMEOUT"))
          : base.collect(options);
      },
    };
    const result = await queryWithDependencies(
      { game, host: "play.example.com" },
      dependencies(a2s),
    );

    expect(result).toMatchObject({
      ok: true,
      game,
      partial: true,
      sources: [{ status: "ok" }, { status: "ok" }, { status: "timeout" }],
      warnings: [
        {
          code: "PARTIAL_RESULT",
          message: `One or more optional ${gameName} query sources did not complete successfully.`,
        },
        { code: "SOURCE_TIMEOUT", source: "a2s-rules" },
      ],
    });
    if (!result.ok) {
      throw new Error(`Expected a successful ${gameName} result.`);
    }
    expect(result.rawData).toBeUndefined();
  });

  it("queries the game port, defaulting to 27015", async (): Promise<void> => {
    const base = await fixtureA2s("source-engine");
    const ports: number[] = [];
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        ports.push(options.target.port);
        return base.collect(options);
      },
    };
    await queryWithDependencies(
      { game, host: "play.example.com", mode: "summary" },
      dependencies(a2s),
    );
    await queryWithDependencies(
      { game, host: "play.example.com", port: 27_016, mode: "summary" },
      dependencies(a2s),
    );
    await queryWithDependencies(
      { game, host: "play.example.com", port: 27_016, queryPort: 27_100, mode: "summary" },
      dependencies(a2s),
    );

    expect(ports).toEqual([27_015, 27_016, 27_100]);
  });
});
