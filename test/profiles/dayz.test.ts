import { describe, expect, it } from "vitest";

import type { A2sExchangeDependencies } from "../../src/protocols/a2s/network.js";
import { queryWithDependencies } from "../../src/runtime/client.js";
import type { UdpCollectionResult } from "../../src/transports/udp.js";
import { dependencies, fixtureA2s, packetType } from "../helpers/a2s-profile.js";

describe("DayZ game profile", (): void => {
  it("merges Info and Rules while representing Player as unsupported", async (): Promise<void> => {
    const requested: number[] = [];
    const base = await fixtureA2s("dayz");
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        requested.push(packetType(options));
        return base.collect(options);
      },
    };
    const result = await queryWithDependencies(
      { game: "dayz", host: "play.example.com" },
      dependencies(a2s),
    );

    expect(result).toEqual({
      ok: true,
      game: "dayz",
      server: {
        name: "QueryHost DayZ Fixture",
        map: "ChernarusPlus",
        version: "1.29.159680",
        password: false,
        players: { online: 12, max: 60 },
        queryRttMs: 8,
      },
      data: {
        tags: [
          "battleye",
          "external",
          "shard000",
          "lqs3",
          "etm6.000000",
          "entm1.500000",
          "mod",
          "14:35",
        ],
        rulesProtocol: 2,
        description: "Synthetic DayZ server",
        mods: [
          { name: "Community Framework", workshopId: "1559212036", hash: 1_218_956_183 },
          { name: "Fixture Mod", workshopId: "123456789", hash: 4_294_967_295 },
        ],
        signatures: ["dayz", "fixture"],
        island: "ChernarusPlus",
        platform: "windows",
        dedicated: true,
        allowedBuild: 0,
        clientPort: 2302,
        requiredBuild: 0,
        requiredVersion: 129,
        timeLeft: 15,
        language: 65_545,
      },
      rawData: {
        rules: {
          allowedBuild: "0",
          clientPort: "2302",
          dedicated: "1",
          island: "ChernarusPlus",
          language: "65545",
          platform: "win",
          requiredBuild: "0",
          requiredVersion: "129",
          timeLeft: "15",
        },
      },
      sources: [
        { source: "a2s-info", status: "ok", rttMs: 8 },
        { source: "a2s-player", status: "unsupported" },
        { source: "a2s-rules", status: "ok", rttMs: 6 },
      ],
      partial: false,
      warnings: [],
      durationMs: 25,
    });
    expect(requested).toEqual([0x54, 0x56]);
  });

  it("uses game port 2302 and the conventional Steam query port 2305", async (): Promise<void> => {
    const base = await fixtureA2s("dayz");
    const ports: number[] = [];
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        ports.push(options.target.port);
        return base.collect(options);
      },
    };
    await queryWithDependencies(
      { game: "dayz", host: "play.example.com", mode: "summary" },
      dependencies(a2s),
    );
    await queryWithDependencies(
      { game: "dayz", host: "play.example.com", port: 2402, mode: "summary" },
      dependencies(a2s),
    );
    await queryWithDependencies(
      { game: "dayz", host: "play.example.com", queryPort: 27_016, mode: "summary" },
      dependencies(a2s),
    );

    expect(ports).toEqual([2305, 2405, 27_016]);
  });
});
