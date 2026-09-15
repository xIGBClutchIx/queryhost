import { describe, expect, it } from "vitest";

import type { A2sExchangeDependencies } from "../../src/protocols/a2s/network.js";
import { queryWithDependencies } from "../../src/runtime/client.js";
import { UdpTransportError } from "../../src/transports/udp.js";
import { dependencies, fixtureA2s, packetType } from "../helpers/a2s-profile.js";

describe("Palworld game profile", (): void => {
  it("merges public A2S data while preserving conditional Player and Rules values", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "palworld", host: "play.example.com", mode: "full" },
      dependencies(await fixtureA2s("palworld")),
    );

    expect(result).toEqual({
      ok: true,
      game: "palworld",
      server: {
        name: "QueryHost Palworld Fixture",
        map: "MainWorld5",
        version: "v1.0.4.102642",
        password: false,
        players: { online: 3, max: 32 },
        queryRttMs: 8,
      },
      data: {
        tags: ["Palworld", "community"],
        players: [
          { index: 0, name: "PalOne", score: 0, durationSeconds: 42.5 },
          { index: 1, name: "PalTwo", score: 7, durationSeconds: 120.25 },
        ],
      },
      rawData: {
        rules: {
          ServerDescription: "QueryHost Palworld fixture",
          PublicPort: "8211",
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

  it("uses the fixed conventional query port and honors an explicit override", async (): Promise<void> => {
    const ports: number[] = [];
    const base = await fixtureA2s("palworld");
    const a2s = {
      collect(options: Parameters<typeof base.collect>[0]): ReturnType<typeof base.collect> {
        ports.push(options.target.port);
        return base.collect(options);
      },
    };

    await queryWithDependencies(
      { game: "palworld", host: "play.example.com", port: 9000, mode: "summary" },
      dependencies(a2s),
    );
    await queryWithDependencies(
      { game: "palworld", host: "play.example.com", port: 9000, queryPort: 28000, mode: "summary" },
      dependencies(a2s),
    );

    expect(ports).toEqual([27015, 28000]);
  });

  it("distinguishes confirmed-empty enrichment from skipped enrichment", async (): Promise<void> => {
    const base = await fixtureA2s("palworld");
    const a2s = {
      collect(options: Parameters<typeof base.collect>[0]): ReturnType<typeof base.collect> {
        const type = packetType(options);
        if (type === 0x55 || type === 0x56) {
          return Promise.resolve({
            datagrams: [
              new Uint8Array([
                0xff,
                0xff,
                0xff,
                0xff,
                type === 0x55 ? 0x44 : 0x45,
                0,
                ...(type === 0x56 ? [0] : []),
              ]),
            ],
            rttMs: 4,
            address: options.address,
            port: options.target.port,
          });
        }
        return base.collect(options);
      },
    };

    const full = await queryWithDependencies(
      { game: "palworld", host: "play.example.com", mode: "full" },
      dependencies(a2s),
    );
    const summary = await queryWithDependencies(
      { game: "palworld", host: "play.example.com", mode: "summary" },
      dependencies(a2s),
    );

    expect(full).toMatchObject({
      ok: true,
      data: { players: [] },
      rawData: { rules: {} },
      partial: false,
    });
    expect(summary).toMatchObject({
      ok: true,
      data: {},
      sources: [
        { source: "a2s-info", status: "ok" },
        { source: "a2s-player", status: "not-requested" },
        { source: "a2s-rules", status: "not-requested" },
      ],
      partial: false,
    });
    if (!summary.ok || summary.game !== "palworld") {
      throw new Error("Expected a Palworld summary result.");
    }
    expect(summary.data.players).toBeUndefined();
    expect(summary.rawData).toBeUndefined();
  });

  it("keeps Info as a partial success when a conditional source is unavailable", async (): Promise<void> => {
    const base = await fixtureA2s("palworld");
    const a2s: A2sExchangeDependencies = {
      collect(options) {
        return packetType(options) === 0x55
          ? Promise.reject(new UdpTransportError("TIMEOUT"))
          : base.collect(options);
      },
    };

    const result = await queryWithDependencies(
      { game: "palworld", host: "play.example.com", mode: "full" },
      dependencies(a2s),
    );

    expect(result).toMatchObject({
      ok: true,
      game: "palworld",
      partial: true,
      rawData: { rules: { PublicPort: "8211" } },
      sources: [
        { source: "a2s-info", status: "ok" },
        { source: "a2s-player", status: "timeout" },
        { source: "a2s-rules", status: "ok" },
      ],
      warnings: [
        { code: "PARTIAL_RESULT" },
        { code: "PLAYER_LIST_UNAVAILABLE", source: "a2s-player" },
        { code: "SOURCE_TIMEOUT", source: "a2s-player" },
      ],
    });
    if (!result.ok || result.game !== "palworld") {
      throw new Error("Expected a successful Palworld result.");
    }
    expect(result.data.players).toBeUndefined();
  });
});
