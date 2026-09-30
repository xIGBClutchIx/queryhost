import { describe, expect, it } from "vitest";

import { queryWithDependencies } from "../../src/runtime/client.js";
import { dependencies } from "../helpers/a2s-profile.js";
import { packetA2s, sourceInfoPacket } from "../helpers/a2s-packets.js";

async function summary(
  info: Uint8Array,
): Promise<Awaited<ReturnType<typeof queryWithDependencies>>> {
  return queryWithDependencies(
    { game: "the-forest", host: "play.example.com", mode: "summary" },
    dependencies(packetA2s({ info })),
  );
}

describe("shared Steam A2S Info fields", (): void => {
  it("restores the full App ID from the 64-bit game ID", async (): Promise<void> => {
    const result = await summary(
      sourceInfoPacket({ game: "The Forest", appId: 242_760 & 0xffff, gameId: 242_760n }),
    );

    expect(result).toMatchObject({ ok: true, data: { game: "The Forest", appId: 242_760 } });
  });

  it("keeps only the App ID bits of a mod game ID", async (): Promise<void> => {
    const result = await summary(sourceInfoPacket({ appId: 4000, gameId: (1n << 56n) | 4000n }));

    expect(result).toMatchObject({ ok: true, data: { appId: 4000 } });
  });

  it("falls back to the 16-bit App ID and omits absent extra data", async (): Promise<void> => {
    const result = await summary(sourceInfoPacket({ appId: 45_000 }));

    if (!result.ok) {
      throw new Error("Expected a successful query.");
    }
    expect(result.data).toEqual({
      game: "Game",
      folder: "folder",
      bots: 0,
      serverType: "dedicated",
      environment: "linux",
      vac: false,
      appId: 45_000,
    });
  });

  it("reports the advertised game port and server Steam ID as text", async (): Promise<void> => {
    const result = await summary(
      sourceInfoPacket({ port: 27_015, steamId: 90_071_992_547_409_921n }),
    );

    expect(result).toMatchObject({
      ok: true,
      data: { gamePort: 27_015, serverSteamId: "90071992547409921" },
    });
  });
});
