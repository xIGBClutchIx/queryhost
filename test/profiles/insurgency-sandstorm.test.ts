import { describe, expect, it } from "vitest";

import { queryWithDependencies } from "../../src/runtime/client.js";
import { dependencies } from "../helpers/a2s-profile.js";
import { packetA2s, rulesPacket, sourceInfoPacket } from "../helpers/a2s-packets.js";

async function sandstorm(
  rules: Parameters<typeof rulesPacket>[0],
): Promise<Awaited<ReturnType<typeof queryWithDependencies>>> {
  return queryWithDependencies(
    { game: "sandstorm", host: "play.example.com" },
    dependencies(packetA2s({ info: sourceInfoPacket(), rules: rulesPacket(rules) })),
  );
}

describe("insurgency-sandstorm game profile", (): void => {
  it("types mode, lighting, ranking, mutators, and mods", async (): Promise<void> => {
    const result = await sandstorm([
      ["GameMode_s", "Checkpoint"],
      ["Coop_b", "true"],
      ["Day_b", "false"],
      ["RankedServer_b", "false"],
      ["Mutated_b", "true"],
      ["Mutators_s", "Hardcore,AllYouCanEat"],
      ["Mods_b", "true"],
      ["ModList_s", "1141916,1234567"],
    ]);

    expect(result).toMatchObject({
      ok: true,
      data: {
        gameMode: "Checkpoint",
        coop: true,
        lighting: "night",
        ranked: false,
        mutators: ["Hardcore", "AllYouCanEat"],
        modIds: ["1141916", "1234567"],
      },
    });
  });

  it("confirms empty lists only when their switch is off", async (): Promise<void> => {
    const off = await sandstorm([
      ["Mutated_b", "false"],
      ["Mods_b", "false"],
    ]);
    const missing = await sandstorm([
      ["Mutated_b", "true"],
      ["Mods_b", "true"],
      ["ModList_s", "abc"],
    ]);

    expect(off).toMatchObject({ ok: true, data: { mutators: [], modIds: [] } });
    if (!missing.ok || missing.game !== "insurgency-sandstorm") {
      throw new Error("Expected an Insurgency: Sandstorm result.");
    }
    expect(missing.data).not.toHaveProperty("mutators");
    expect(missing.data).not.toHaveProperty("modIds");
  });
});
