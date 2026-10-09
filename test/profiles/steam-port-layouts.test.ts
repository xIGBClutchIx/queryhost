import { describe, expect, it } from "vitest";

import type { A2sExchangeDependencies } from "../../src/protocols/a2s/network.js";
import { queryWithDependencies } from "../../src/runtime/client.js";
import type { UdpCollectionResult } from "../../src/transports/udp.js";
import { dependencies, fixtureA2s } from "../helpers/a2s-profile.js";
import { packetA2s, playersPacket, rulesPacket, sourceInfoPacket } from "../helpers/a2s-packets.js";
import { MetadataWriter, metadataPages } from "../helpers/bohemia-pages.js";

/**
 * Canonical ID, accepted input, then the query destinations for the default port, a custom game
 * port, and an explicit query port override.
 */
const PORT_LAYOUTS = [
  ["arma-3", "a3", 2400, [2303, 2401, 3000]],
  ["american-truck-simulator", "ats", 28_000, [27_016, 27_016, 3000]],
  ["euro-truck-simulator-2", "ets2", 28_000, [27_016, 27_016, 3000]],
  ["the-forest", "theforest", 28_000, [27_016, 27_016, 3000]],
  ["unturned", "unturned", 28_000, [27_015, 28_000, 3000]],
  ["enshrouded", "enshrouded", 16_000, [15_637, 16_000, 3000]],
  ["insurgency-sandstorm", "sandstorm", 28_000, [27_131, 27_131, 3000]],
  ["vein", "vein", 7800, [7778, 7801, 3000]],
  ["avorion", "avorion", 28_000, [27_020, 27_020, 3000]],
] as const;

describe.each(PORT_LAYOUTS)("%s game profile", (game, alias, customPort, expected): void => {
  it("resolves its alias and follows the game's query-port rule", async (): Promise<void> => {
    const base = await fixtureA2s("steam-query-port");
    const ports: number[] = [];
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        ports.push(options.target.port);
        return base.collect(options);
      },
    };
    const first = await queryWithDependencies(
      { game: alias, host: "play.example.com", mode: "summary" },
      dependencies(a2s),
    );
    await queryWithDependencies(
      { game, host: "play.example.com", port: customPort, mode: "summary" },
      dependencies(a2s),
    );
    await queryWithDependencies(
      { game, host: "play.example.com", queryPort: 3000, mode: "summary" },
      dependencies(a2s),
    );

    expect(first).toMatchObject({
      ok: true,
      game,
      server: { name: "QueryHost Steam Fixture", players: { online: 2, max: 70 } },
      data: { tags: ["pve", "crossplay"] },
    });
    expect(ports).toEqual(expected);
  });
});

describe.each(PORT_LAYOUTS)("%s full query", (game): void => {
  it("merges Player and raw Rules", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game, host: "play.example.com" },
      dependencies(await fixtureA2s("steam-query-port")),
    );

    expect(result).toMatchObject({
      ok: true,
      game,
      data: { players: [{ name: "Survivor" }, { name: "" }] },
      rawData: { rules: { SESSIONFLAGS: "683", ServerPassword_b: "false" } },
      partial: false,
    });
  });
});

describe("arma-3 full query", (): void => {
  it("decodes paged Rules metadata into mods, DLC, and difficulty", async (): Promise<void> => {
    const metadata = new MetadataWriter()
      .uint8(3)
      .uint8(0)
      .uint16(0x0400)
      .uint8(0b0000_1001)
      .uint8(0)
      .uint32(12)
      .uint8(2)
      .uint32(5)
      .uint8(4)
      .uint32(450_814_997)
      .string("CBA_A3")
      .uint32(6)
      .uint8(19)
      .uint32(9_999_999)
      .uint8(1)
      .string("a3")
      .build();
    const result = await queryWithDependencies(
      { game: "arma-3", host: "play.example.com" },
      dependencies(
        packetA2s({
          info: sourceInfoPacket({ game: "Antistasi", map: "Altis", gameId: 107_410n }),
          players: playersPacket([]),
          rules: rulesPacket(metadataPages(metadata)),
        }),
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      game: "arma-3",
      data: {
        game: "Antistasi",
        appId: 107_410,
        players: [],
        rulesProtocol: 3,
        difficulty: {
          level: 1,
          aiLevel: 1,
          advancedFlightModel: true,
          thirdPerson: false,
          crosshair: false,
        },
        dlc: [{ flag: 0x400, name: "Contact", appId: 1_021_790, hash: 12 }],
        creatorDlc: [{ appId: 9_999_999, hash: 6 }],
        mods: [{ name: "CBA_A3", workshopId: "450814997", hash: 5 }],
        signatures: ["a3"],
      },
      rawData: { rules: {} },
      sources: [
        { source: "a2s-info", status: "ok" },
        { source: "a2s-player", status: "ok" },
        { source: "a2s-rules", status: "ok" },
      ],
      partial: false,
    });
  });

  it("names known Creator DLC", async (): Promise<void> => {
    const metadata = new MetadataWriter()
      .uint8(3)
      .uint8(0)
      .uint16(0)
      .uint8(0)
      .uint8(0)
      .uint8(1)
      .uint32(6)
      .uint8(19)
      .uint32(1_175_380)
      .uint8(0)
      .build();
    const result = await queryWithDependencies(
      { game: "arma-3", host: "play.example.com" },
      dependencies(
        packetA2s({ info: sourceInfoPacket(), rules: rulesPacket(metadataPages(metadata)) }),
      ),
    );

    expect(result).toMatchObject({
      ok: true,
      data: { creatorDlc: [{ appId: 1_175_380, name: "Spearhead 1944", hash: 6 }], mods: [] },
    });
  });

  it("decodes Bohemia's one-letter keyword fields", async (): Promise<void> => {
    const keywords =
      "bt,r218,n150779,s7,i1,mf,lt,vt,dt,tzeus,g65541,h285fa806,oDE,f0,pw,e15,yAltis,c-25--25,x1,bf";
    const result = await queryWithDependencies(
      { game: "arma-3", host: "play.example.com", mode: "summary" },
      dependencies(packetA2s({ info: sourceInfoPacket({ keywords }) })),
    );

    if (!result.ok) {
      throw new Error("Expected a successful Arma 3 result.");
    }
    expect(result.data).toMatchObject({
      battlEye: true,
      requiredVersion: 218,
      requiredBuild: 150_779,
      serverState: 7,
      gameType: "zeus",
      equalModsRequired: false,
      locked: true,
      verifySignatures: true,
      dedicated: true,
      filePatching: false,
      platform: "windows",
      language: 65_541,
      country: "DE",
      timeLeftMinutes: 15,
      island: "Altis",
      loadedContentHash: "285fa806",
    });
    expect(result.game === "arma-3" ? result.data.tags : undefined).toContain("x1");
  });

  it("omits keyword fields whose values are not valid", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "arma-3", host: "play.example.com", mode: "summary" },
      dependencies(packetA2s({ info: sourceInfoPacket({ keywords: "byes,s12,pq,r-1,t,e01" }) })),
    );

    if (!result.ok) {
      throw new Error("Expected a successful Arma 3 result.");
    }
    for (const field of [
      "battlEye",
      "serverState",
      "platform",
      "requiredVersion",
      "gameType",
      "timeLeftMinutes",
    ]) {
      expect(result.data).not.toHaveProperty(field);
    }
  });
});
