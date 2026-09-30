import { describe, expect, it } from "vitest";

import { queryWithDependencies } from "../../src/runtime/client.js";
import { dependencies } from "../helpers/a2s-profile.js";
import { packetA2s, sourceInfoPacket } from "../helpers/a2s-packets.js";

async function gmod(keywords: string): Promise<Awaited<ReturnType<typeof queryWithDependencies>>> {
  return queryWithDependencies(
    { game: "gmod", host: "play.example.com", mode: "summary" },
    dependencies(packetA2s({ info: sourceInfoPacket({ folder: "garrysmod", keywords }) })),
  );
}

describe("garrys-mod game profile", (): void => {
  it("types the space-separated gamemode keywords", async (): Promise<void> => {
    const result = await gmod("gm:darkrp gmws:2724150474 gmc:rp loc:us ver:260917");

    expect(result).toMatchObject({
      ok: true,
      data: {
        tags: ["gm:darkrp", "gmws:2724150474", "gmc:rp", "loc:us", "ver:260917"],
        gamemode: "darkrp",
        gamemodeWorkshopId: "2724150474",
        gamemodeCategory: "rp",
        location: "us",
        build: "260917",
      },
    });
  });

  it("omits keys that are absent or malformed", async (): Promise<void> => {
    const result = await gmod("gm:sandbox gmws:abc ver:2026 hltv:1");

    if (!result.ok || result.game !== "garrys-mod") {
      throw new Error("Expected a Garry's Mod result.");
    }
    expect(result.data).toMatchObject({ gamemode: "sandbox" });
    for (const field of ["gamemodeWorkshopId", "gamemodeCategory", "location", "build"]) {
      expect(result.data).not.toHaveProperty(field);
    }
  });
});
