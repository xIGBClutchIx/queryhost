import { describe, expect, it } from "vitest";

import { queryWithDependencies } from "../src/client.js";
import type { A2sExchangeDependencies } from "../src/protocols/a2s/network.js";
import { UdpTransportError, type UdpCollectionResult } from "../src/transports/udp.js";
import { dependencies, fixtureA2s, packetType } from "./helpers/a2s-profile.js";

describe("7 Days to Die game profile", (): void => {
  it("merges independent Info, Player, and Rules fixtures", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "7-days-to-die", host: "play.example.com" },
      dependencies(await fixtureA2s("seven-days-to-die")),
    );

    expect(result).toEqual({
      ok: true,
      game: "7-days-to-die",
      server: {
        name: "QueryHost 7 Days to Die Fixture",
        map: "Navezgane",
        version: "V 2.4 (b5)",
        password: true,
        players: { online: 1, max: 16 },
        queryRttMs: 8,
      },
      data: {
        description: "Blood moon fixture",
        gameName: "QueryHost Test",
        gameWorld: "Navezgane",
        gameMode: "GameModeSurvival",
        currentServerTime: "Day 14, 22:30",
        websiteUrl: "https://query.host",
        players: [{ index: 0, name: "Riley", score: 7, durationSeconds: 321.5 }],
        rules: {
          ServerDescription: "Blood moon fixture",
          GameName: "QueryHost Test",
          GameWorld: "Navezgane",
          GameMode: "GameModeSurvival",
          CurrentServerTime: "Day 14, 22:30",
          ServerWebsiteURL: "https://query.host",
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

  it("keeps Rules when Player times out", async (): Promise<void> => {
    const base = await fixtureA2s("seven-days-to-die");
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        return packetType(options) === 0x55
          ? Promise.reject(new UdpTransportError("TIMEOUT"))
          : base.collect(options);
      },
    };
    const result = await queryWithDependencies(
      { game: "7-days-to-die", host: "play.example.com" },
      dependencies(a2s),
    );

    expect(result).toMatchObject({
      ok: true,
      game: "7-days-to-die",
      partial: true,
      sources: [{ status: "ok" }, { status: "timeout" }, { status: "ok" }],
      warnings: [
        { code: "PARTIAL_RESULT" },
        { code: "PLAYER_LIST_UNAVAILABLE" },
        { code: "SOURCE_TIMEOUT" },
      ],
    });
    if (!result.ok || result.game !== "7-days-to-die") {
      throw new Error("Expected a successful 7 Days to Die result.");
    }
    expect(result.data.players).toBeUndefined();
    expect(result.data.currentServerTime).toBe("Day 14, 22:30");
  });

  it("uses UDP 26900 by default and honors an explicit query port", async (): Promise<void> => {
    const base = await fixtureA2s("seven-days-to-die");
    const ports: number[] = [];
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        ports.push(options.target.port);
        return base.collect(options);
      },
    };
    await queryWithDependencies(
      { game: "7-days-to-die", host: "play.example.com", mode: "summary" },
      dependencies(a2s),
    );
    await queryWithDependencies(
      { game: "7-days-to-die", host: "play.example.com", queryPort: 27_000, mode: "summary" },
      dependencies(a2s),
    );
    expect(ports).toEqual([26_900, 27_000]);
  });
});
