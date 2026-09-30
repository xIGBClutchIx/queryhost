import { describe, expect, it } from "vitest";

import { queryWithDependencies } from "../../src/runtime/client.js";
import { dependencies } from "../helpers/a2s-profile.js";
import { packetA2s, rulesPacket, sourceInfoPacket } from "../helpers/a2s-packets.js";

async function query(
  game: "conan-exiles" | "abiotic-factor" | "icarus" | "insurgency-sandstorm",
  keywords: string,
  rules?: Parameters<typeof rulesPacket>[0],
): Promise<Awaited<ReturnType<typeof queryWithDependencies>>> {
  return queryWithDependencies(
    { game, host: "play.example.com", mode: rules === undefined ? "summary" : "full" },
    dependencies(
      packetA2s({
        info: sourceInfoPacket({ keywords }),
        ...(rules === undefined ? {} : { rules: rulesPacket(rules) }),
      }),
    ),
  );
}

describe("Unreal Engine session values", (): void => {
  it("keeps commas inside a keyword value and reads Conan's full name", async (): Promise<void> => {
    const result = await query(
      "conan-exiles",
      "BUILDID:256536549,OWNINGID:90100000000000001,OWNINGNAME:Exiles, PvE, Mods,HOSTIP:532347565",
    );

    expect(result).toMatchObject({
      ok: true,
      data: { buildId: 256_536_549, fullServerName: "Exiles, PvE, Mods" },
    });
  });

  it("reads Abiotic Factor's join code and lock from keywords", async (): Promise<void> => {
    const result = await query(
      "abiotic-factor",
      "BUILDID:1000012,OWNINGID:1,OWNINGNAME:Ozone,SESSIONFLAGS:43,ShortCode_s:X8498,GamePort_i:7777,Locked_b:true",
    );

    expect(result).toMatchObject({
      ok: true,
      data: {
        buildId: 1_000_012,
        joinCode: "X8498",
        locked: true,
        sessionFlags: {
          advertised: true,
          joinInProgress: true,
          dedicated: true,
          invites: true,
          antiCheatProtected: false,
        },
      },
    });
  });

  it("lets Rules override keywords and accepts a typed build rule", async (): Promise<void> => {
    const result = await query(
      "insurgency-sandstorm",
      "BUILDID:1,NUMOPENPUBCONN:4,SESSIONFLAGS:2048",
      [
        ["BUILDID_i", "12345"],
        ["NUMOPENPUBCONN", "9"],
      ],
    );

    if (!result.ok || result.game !== "insurgency-sandstorm") {
      throw new Error("Expected an Insurgency: Sandstorm result.");
    }
    expect(result.data).toMatchObject({ buildId: 12_345, openPublicSlots: 9 });
    // 2048 sets a bit beyond the ten defined flags, so the field is not typed.
    expect(result.data).not.toHaveProperty("sessionFlags");
  });

  it("types nothing from keywords without Unreal pairs", async (): Promise<void> => {
    const result = await query("icarus", "pve, crossplay");

    if (!result.ok || result.game !== "icarus") {
      throw new Error("Expected an Icarus result.");
    }
    for (const field of ["buildId", "openPublicSlots", "sessionFlags"]) {
      expect(result.data).not.toHaveProperty(field);
    }
  });
});
