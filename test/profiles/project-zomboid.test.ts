import { describe, expect, it } from "vitest";

import type { A2sExchangeDependencies } from "../../src/protocols/a2s/network.js";
import { queryWithDependencies } from "../../src/runtime/client.js";
import { UdpTransportError, type UdpCollectionResult } from "../../src/transports/udp.js";
import { dependencies, fixtureA2s, packetType } from "../helpers/a2s-profile.js";

describe("Project Zomboid game profile", (): void => {
  it("merges independent Info, Player, and Rules fixtures", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "project-zomboid", host: "play.example.com" },
      dependencies(await fixtureA2s("project-zomboid")),
    );

    expect(result).toEqual({
      ok: true,
      game: "project-zomboid",
      server: {
        name: "QueryHost Project Zomboid Fixture",
        map: "Muldraugh, KY",
        version: "42.20",
        password: false,
        players: { online: 2, max: 32 },
        queryRttMs: 8,
      },
      data: {
        description: "Cooperative survival fixture",
        pvp: true,
        mods: [],
        players: [
          { index: 0, name: "Avery", score: 4, durationSeconds: 87.5 },
          { index: 1, name: "Morgan", score: 0, durationSeconds: 12.25 },
        ],
      },
      rawData: {
        rules: {
          description: "Cooperative survival fixture",
          modCount: "0",
          mods: "",
          open: "1",
          public: "0",
          pvp: "1",
          version: "42.20",
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
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("keeps a useful partial result when Rules time out", async (): Promise<void> => {
    const base = await fixtureA2s("project-zomboid");
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        return packetType(options) === 0x56
          ? Promise.reject(new UdpTransportError("TIMEOUT"))
          : base.collect(options);
      },
    };
    const result = await queryWithDependencies(
      { game: "project-zomboid", host: "play.example.com" },
      dependencies(a2s),
    );

    expect(result).toMatchObject({
      ok: true,
      game: "project-zomboid",
      partial: true,
      sources: [{ status: "ok" }, { status: "ok" }, { status: "timeout" }],
      warnings: [{ code: "PARTIAL_RESULT" }, { code: "SOURCE_TIMEOUT" }],
    });
    if (!result.ok || result.game !== "project-zomboid") {
      throw new Error("Expected a successful Project Zomboid result.");
    }
    expect(result.data.players).toHaveLength(2);
    expect(result.rawData).toBeUndefined();
    expect(result.data.mods).toBeUndefined();
    expect(result.server.version).toBe("42.12.3");
  });

  it("uses UDP 16261 by default and honors an explicit query port", async (): Promise<void> => {
    const base = await fixtureA2s("project-zomboid");
    const ports: number[] = [];
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        ports.push(options.target.port);
        return base.collect(options);
      },
    };
    await queryWithDependencies(
      { game: "project-zomboid", host: "play.example.com", mode: "summary" },
      dependencies(a2s),
    );
    await queryWithDependencies(
      { game: "project-zomboid", host: "play.example.com", queryPort: 17_000, mode: "summary" },
      dependencies(a2s),
    );
    expect(ports).toEqual([16_261, 17_000]);
  });
});
