import { describe, expect, it } from "vitest";

import { queryWithDependencies } from "../../src/runtime/client.js";
import { dependencies, fixtureA2s } from "../helpers/a2s-profile.js";

describe("generic A2S profile", (): void => {
  it("returns common protocol facts, optional players, and raw rules", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "a2s", host: "play.example.com", port: 27_015 },
      dependencies(await fixtureA2s("rust")),
    );

    expect(result).toMatchObject({
      ok: true,
      game: "a2s",
      server: {
        name: "QueryHost Rust Fixture",
        map: "Procedural Map",
        version: "2600",
        players: { online: 12, max: 100 },
      },
      data: {
        protocol: 17,
        game: "Rust",
        folder: "rust",
        bots: 0,
        serverType: "dedicated",
        environment: "linux",
        vac: true,
        appId: 55_882,
        tags: ["mp100", "cp0", "weekly", "vanilla"],
        players: [
          { index: 0, name: "Alice", score: 10, durationSeconds: 123.5 },
          { index: 1, name: "Bob", score: -2, durationSeconds: 2.25 },
        ],
      },
      rawData: { rules: { "world.seed": "123456" } },
      partial: false,
    });
  });

  it("requires the caller to supply the A2S query port", async (): Promise<void> => {
    const result = await queryWithDependencies(
      { game: "a2s", host: "play.example.com" },
      dependencies(await fixtureA2s("rust")),
    );

    expect(result).toMatchObject({
      ok: false,
      game: "a2s",
      error: { code: "INVALID_INPUT" },
      sources: [],
    });
  });
});
