import { describe, expect, it } from "vitest";

import { queryWithDependencies } from "../../src/runtime/client.js";
import { dependencies } from "../helpers/a2s-profile.js";
import { packetA2s, rulesPacket, sourceInfoPacket } from "../helpers/a2s-packets.js";

const HASH = "9FE7C0341F2A4D5B8E6C7A1B2C3D4E5F";

async function ark(
  name: string,
  rules: Parameters<typeof rulesPacket>[0],
): Promise<Awaited<ReturnType<typeof queryWithDependencies>>> {
  return queryWithDependencies(
    { game: "ark", host: "play.example.com" },
    dependencies(
      packetA2s({
        info: sourceInfoPacket({ name, version: "1.0.0.0", gameId: 346_110n }),
        rules: rulesPacket(rules),
      }),
    ),
  );
}

describe("ark-survival-evolved game profile", (): void => {
  it("types session Rules and reads the build from the name suffix", async (): Promise<void> => {
    const result = await ark("[1/8] Chaos PvE - (v358.7)", [
      ["CUSTOMSERVERNAME_s", "[1/8] chaos pve"],
      ["SESSIONISPVE_i", "1"],
      ["SERVERUSESBATTLEYE_b", "true"],
      ["OFFICIALSERVER_i", "0"],
      ["ClusterId_s", "5H3MWCljTNBl"],
      ["GameMode_s", "TestGameMode_C"],
      ["DayTime_s", "316"],
      ["ALLOWDOWNLOADCHARS_i", "1"],
      ["ALLOWDOWNLOADITEMS_i", "0"],
      ["HASACTIVEMODS_i", "1"],
      ["MOD0_s", `839162288:${HASH}`],
      ["MOD1_s", `731604991:${HASH}`],
    ]);

    expect(result).toMatchObject({
      ok: true,
      server: { name: "[1/8] Chaos PvE - (v358.7)", version: "358.7" },
      data: {
        appId: 346_110,
        customServerName: "[1/8] chaos pve",
        pve: true,
        battlEye: true,
        official: false,
        clusterId: "5H3MWCljTNBl",
        gameMode: "TestGameMode_C",
        dayTime: "316",
        allowDownloadCharacters: true,
        allowDownloadItems: false,
        mods: [
          { workshopId: "839162288", hash: HASH },
          { workshopId: "731604991", hash: HASH },
        ],
      },
      rawData: { rules: { SESSIONISPVE_i: "1" } },
    });
  });

  it("confirms zero mods only from the active-mods flag", async (): Promise<void> => {
    const none = await ark("Server", [["HASACTIVEMODS_i", "0"]]);
    const unknown = await ark("Server", [["HASACTIVEMODS_i", "1"]]);

    expect(none).toMatchObject({ ok: true, data: { mods: [] } });
    if (!unknown.ok || unknown.game !== "ark-survival-evolved") {
      throw new Error("Expected an ARK result.");
    }
    expect(unknown.data).not.toHaveProperty("mods");
  });

  it("keeps the Info version when the name is truncated before the suffix", async (): Promise<void> => {
    const result = await ark("A very long server name that ARK cut off - (", [
      ["MOD0_s", "not-a-mod"],
    ]);

    if (!result.ok || result.game !== "ark-survival-evolved") {
      throw new Error("Expected an ARK result.");
    }
    expect(result.server.version).toBe("1.0.0.0");
    expect(result.data).not.toHaveProperty("mods");
  });
});
