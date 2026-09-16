import { describe, expect, it, vi } from "vitest";

import type { A2sExchangeDependencies } from "../../src/protocols/a2s/network.js";
import { queryWithDependencies } from "../../src/runtime/client.js";
import {
  UdpTransportError,
  type UdpCollectionOptions,
  type UdpCollectionResult,
} from "../../src/transports/udp.js";
import { dependencies, fixtureA2s, packetType } from "../helpers/a2s-profile.js";

describe("Valheim game profile", (): void => {
  it("merges Steam-backend Info and anonymous Player records without querying Rules", async (): Promise<void> => {
    const base = await fixtureA2s("valheim");
    const collect = vi.fn((options: UdpCollectionOptions) => base.collect(options));
    const result = await queryWithDependencies(
      { game: "valheim", host: "play.example.com" },
      dependencies({ collect }),
    );

    expect(result).toEqual({
      ok: true,
      game: "valheim",
      server: {
        name: "QueryHost Valheim Fixture",
        map: "Dedicated",
        version: "1.0.0.0",
        password: true,
        players: { online: 2, max: 10 },
        queryRttMs: 8,
      },
      data: {
        backend: "steam",
        networkVersion: "0.220.5",
        players: [
          { index: 0, name: "", score: 0, durationSeconds: 321.5 },
          { index: 1, name: "", score: 0, durationSeconds: 12.25 },
        ],
      },
      sources: [
        { source: "a2s-info", status: "ok", rttMs: 8 },
        { source: "a2s-player", status: "ok", rttMs: 5 },
        { source: "a2s-rules", status: "unsupported" },
      ],
      partial: false,
      warnings: [],
      durationMs: 25,
    });
    expect(collect.mock.calls.map(([options]) => packetType(options))).toEqual([0x54, 0x55]);
    if (!result.ok || result.game !== "valheim") {
      throw new Error("Expected a successful Valheim result.");
    }
    expect(result.rawData).toBeUndefined();
  });

  it("keeps Info as a partial result when Player is unavailable", async (): Promise<void> => {
    const base = await fixtureA2s("valheim");
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        return packetType(options) === 0x55
          ? Promise.reject(new UdpTransportError("TIMEOUT"))
          : base.collect(options);
      },
    };
    const result = await queryWithDependencies(
      { game: "valheim", host: "play.example.com" },
      dependencies(a2s),
    );

    expect(result).toMatchObject({
      ok: true,
      game: "valheim",
      partial: true,
      data: { backend: "steam", networkVersion: "0.220.5" },
      sources: [{ status: "ok" }, { status: "timeout" }, { status: "unsupported" }],
      warnings: [
        { code: "PARTIAL_RESULT" },
        { code: "PLAYER_LIST_UNAVAILABLE", source: "a2s-player" },
        { code: "SOURCE_TIMEOUT", source: "a2s-player" },
      ],
    });
    if (!result.ok || result.game !== "valheim") {
      throw new Error("Expected a successful Valheim result.");
    }
    expect(result.data.players).toBeUndefined();
  });

  it("uses game port plus one and honors an explicit query port", async (): Promise<void> => {
    const base = await fixtureA2s("valheim");
    const ports: number[] = [];
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        ports.push(options.target.port);
        return base.collect(options);
      },
    };
    await queryWithDependencies(
      { game: "valheim", host: "play.example.com", mode: "summary" },
      dependencies(a2s),
    );
    await queryWithDependencies(
      { game: "valheim", host: "play.example.com", port: 3000, mode: "summary" },
      dependencies(a2s),
    );
    await queryWithDependencies(
      { game: "valheim", host: "play.example.com", queryPort: 4000, mode: "summary" },
      dependencies(a2s),
    );

    expect(ports).toEqual([2457, 3001, 4000]);
  });
});
