import { describe, expect, it } from "vitest";

import { getGameDefinition } from "../../src/contracts/registry.js";
import { queryWithDependencies } from "../../src/runtime/client.js";
import { dependencies } from "../helpers/a2s-profile.js";
import { packetA2s, rulesPacket, sourceInfoPacket } from "../helpers/a2s-packets.js";

function base64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

async function unturned(
  keywords: string | undefined,
  rules?: Parameters<typeof rulesPacket>[0],
): Promise<Awaited<ReturnType<typeof queryWithDependencies>>> {
  return queryWithDependencies(
    { game: "unturned", host: "play.example.com", mode: rules === undefined ? "summary" : "full" },
    dependencies(
      packetA2s({
        info: sourceInfoPacket({
          game: "Friendly PvE",
          ...(keywords === undefined ? {} : { keywords }),
        }),
        ...(rules === undefined ? {} : { rules: rulesPacket(rules) }),
      }),
    ),
  );
}

describe("unturned game profile", (): void => {
  it("decodes the fixed-order keyword flags and enclosed values", async (): Promise<void> => {
    const result = await unturned(
      "PVE,CHn,HRD,3Pp,WSy,F2P,ACP,BEy,MTXy,<tn>https://example.com/a,b.png</tn>,<net>sns</net>,<pf>rm</pf>",
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        game: "Friendly PvE",
        pvp: false,
        cheats: false,
        difficulty: "hard",
        cameraMode: "third-person",
        workshop: true,
        goldOnly: false,
        anycastProxy: true,
        battlEye: true,
        monetization: "non-gameplay",
        thumbnailUrl: "https://example.com/a,b.png",
        networkTransport: "sns",
        pluginFramework: "rocketmod",
      },
    });
  });

  it("confirms an absent anycast proxy and leaves unspecified values omitted", async (): Promise<void> => {
    const result = await unturned("PVP,CHy,EZY,1Pp,WSn,GLD,BEn,<net>def</net>");

    if (!result.ok || result.game !== "unturned") {
      throw new Error("Expected an Unturned result.");
    }
    expect(result.data).toMatchObject({ pvp: true, goldOnly: true, anycastProxy: false });
    expect(result.data).not.toHaveProperty("monetization");
    expect(result.data).not.toHaveProperty("thumbnailUrl");
    expect(result.data).not.toHaveProperty("pluginFramework");
  });

  it("types nothing from keywords outside Unturned's format", async (): Promise<void> => {
    const result = await unturned("pve,crossplay");

    if (!result.ok || result.game !== "unturned") {
      throw new Error("Expected an Unturned result.");
    }
    expect(result.data).not.toHaveProperty("pvp");
    expect(result.data).not.toHaveProperty("anycastProxy");
    expect(result.data.tags).toEqual(["pve", "crossplay"]);
  });

  it("reassembles chunked Rules values", async (): Promise<void> => {
    const description = base64("Welcome! ".repeat(20));
    const mods = "2136497468,1111111111";
    const result = await unturned(undefined, [
      ["GameVersion", "3.24.5.0"],
      ["Browser_Icon", "https://example.com/icon.png"],
      ["Browser_Desc_Hint", "Hard PvE"],
      ["BookmarkHost", "play.example.com"],
      ["Browser_Desc_Full_Count", "2"],
      ["Browser_Desc_Full_Line_0", description.slice(0, 127)],
      ["Browser_Desc_Full_Line_1", description.slice(127)],
      ["Mod_Count", "2"],
      ["Mod_0", mods.slice(0, 12)],
      ["Mod_1", mods.slice(12)],
      ["Custom_Links_Count", "2"],
      ["Custom_Link_Message_0", base64("Discord")],
      ["Custom_Link_Url_0", base64("https://discord.example.com")],
      ["Cfg_Count", "4"],
      ["Cfg_0", "Items.Spawn_Chance=0.5"],
      ["Cfg_1", "Gameplay.Can_Suicide=F"],
      ["Cfg_2", "broken"],
      ["Cfg_3", "Items.Spawn_Chance=0.9"],
      ["rocketplugins", "Kits, Uconomy"],
    ]);

    expect(result).toMatchObject({
      ok: true,
      data: {
        gameVersion: "3.24.5.0",
        iconUrl: "https://example.com/icon.png",
        descriptionHint: "Hard PvE",
        bookmarkHost: "play.example.com",
        description: "Welcome! ".repeat(20),
        workshopIds: ["2136497468", "1111111111"],
        links: [{ message: "Discord", url: "https://discord.example.com" }],
        config: { "Items.Spawn_Chance": 0.5, "Gameplay.Can_Suicide": false },
        plugins: ["Kits", "Uconomy"],
      },
      rawData: { rules: { GameVersion: "3.24.5.0" } },
    });
  });

  it("omits chunked values with a missing chunk or invalid Base64", async (): Promise<void> => {
    const result = await unturned(undefined, [
      ["Browser_Desc_Full_Count", "1"],
      ["Browser_Desc_Full_Line_0", "not base64!"],
      ["Mod_Count", "2"],
      ["Mod_0", "123"],
    ]);

    if (!result.ok || result.game !== "unturned") {
      throw new Error("Expected an Unturned result.");
    }
    expect(result.data).not.toHaveProperty("description");
    expect(result.data).not.toHaveProperty("workshopIds");
  });

  it("declares conditional mods and plugins", (): void => {
    expect(getGameDefinition("unturned").capabilities).toMatchObject({
      mods: "conditional",
      plugins: "conditional",
    });
  });
});
