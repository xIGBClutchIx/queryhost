import { describe, expect, it } from "vitest";

import { queryWithDependencies } from "../../src/runtime/client.js";
import { dependencies } from "../helpers/a2s-profile.js";
import { packetA2s, rulesPacket, sourceInfoPacket } from "../helpers/a2s-packets.js";

async function kf2(
  rules: Parameters<typeof rulesPacket>[0],
): Promise<Awaited<ReturnType<typeof queryWithDependencies>>> {
  return queryWithDependencies(
    { game: "kf2", host: "play.example.com" },
    dependencies(
      packetA2s({
        info: sourceInfoPacket({ game: "KFGameInfo_Survival", version: "1150" }),
        rules: rulesPacket(rules),
      }),
    ),
  );
}

describe("killing-floor-2 game profile", (): void => {
  it("types the match Rules", async (): Promise<void> => {
    // Key names and value spellings follow captured Killing Floor 2 Rules answers.
    const result = await kf2([
      ["Mode", "Survival"],
      ["Difficulty", "3"],
      ["CurrentWave", "5"],
      ["NumWaves", "7"],
      ["bInProgress", "True"],
      ["bMutators", "False"],
      ["bCustom", "True"],
      ["NumSpectators", "0"],
      ["ZedCount", "10"],
      ["MapName", "KF-BurningParis"],
    ]);

    expect(result).toMatchObject({
      ok: true,
      server: { version: "1150" },
      data: {
        game: "KFGameInfo_Survival",
        gameMode: "Survival",
        difficulty: "hell-on-earth",
        currentWave: 5,
        totalWaves: 7,
        inProgress: true,
        mutators: false,
        custom: true,
        spectators: 0,
      },
      rawData: { rules: { ZedCount: "10", MapName: "KF-BurningParis" } },
    });
  });

  it("omits values outside the documented spellings and ranges", async (): Promise<void> => {
    const result = await kf2([
      ["Difficulty", "4"],
      ["bInProgress", "1"],
      ["CurrentWave", "-1"],
    ]);

    if (!result.ok || result.game !== "killing-floor-2") {
      throw new Error("Expected a Killing Floor 2 result.");
    }
    expect(result.data).not.toHaveProperty("difficulty");
    expect(result.data).not.toHaveProperty("inProgress");
    expect(result.data).not.toHaveProperty("currentWave");
  });
});
