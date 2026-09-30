import { describe, expect, it } from "vitest";

import { queryWithDependencies } from "../../src/runtime/client.js";
import { dependencies } from "../helpers/a2s-profile.js";
import { packetA2s, sourceInfoPacket } from "../helpers/a2s-packets.js";

async function tf2(keywords?: string): Promise<Awaited<ReturnType<typeof queryWithDependencies>>> {
  return queryWithDependencies(
    { game: "tf2", host: "play.example.com", mode: "summary" },
    dependencies(
      packetA2s({
        info: sourceInfoPacket({ folder: "tf", ...(keywords === undefined ? {} : { keywords }) }),
      }),
    ),
  );
}

describe("team-fortress-2 game profile", (): void => {
  it("derives game modes and settings from automatic tags", async (): Promise<void> => {
    const result = await tf2("cp,ctf,friendlyfire,nocrits,highlander,medieval,cp,_registered");

    expect(result).toMatchObject({
      ok: true,
      data: {
        gameModes: ["cp", "ctf"],
        friendlyFire: true,
        randomCrits: false,
        highlander: true,
        medieval: true,
      },
    });
  });

  it("omits tag-derived fields when the server sends no keywords", async (): Promise<void> => {
    const result = await tf2();

    if (!result.ok || result.game !== "team-fortress-2") {
      throw new Error("Expected a Team Fortress 2 result.");
    }
    for (const field of ["gameModes", "friendlyFire", "randomCrits", "highlander", "medieval"]) {
      expect(result.data).not.toHaveProperty(field);
    }
  });
});
