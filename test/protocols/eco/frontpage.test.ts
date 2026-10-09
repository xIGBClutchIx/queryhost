import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { EcoProtocolError } from "../../../src/protocols/eco/errors.js";
import { parseEcoFrontpage, plainEcoText } from "../../../src/protocols/eco/frontpage.js";

const FIXTURE = readFileSync(new URL("../../fixtures/eco/frontpage.json", import.meta.url), "utf8");

function encode(body: string): Uint8Array {
  return new TextEncoder().encode(body);
}

describe("Eco frontpage", (): void => {
  it("parses every retained Info field and drops unknown keys", (): void => {
    expect(parseEcoFrontpage(encode(FIXTURE))).toEqual({
      description: "<color=#7CFC00><b>Green Valley</b></color> | <size=80%>Vanilla</size>",
      detailedDescription: "<i>Collaborative</i> world, meteor on.",
      version: "0.11.1.5 beta release-786",
      hasPassword: false,
      onlinePlayers: 2,
      onlinePlayerNames: ["Ada", "Linus"],
      totalPlayers: 41,
      activeAndOnlinePlayers: 9,
      peakActivePlayers: 14,
      maxActivePlayers: 0,
      adminOnline: false,
      category: "Beginner",
      language: "English",
      worldSize: "0.52 km²",
      economyDescription: "312 trades",
      skillSpecialization: "Default",
      playtimes: "",
      discordAddress: "",
      joinUrl: "eco://connect/play.example.com:3000",
      access: "Public",
      gamePort: 3000,
      webPort: 3001,
      external: true,
      lan: false,
      paused: false,
      meteor: true,
      timeSinceStartSeconds: 432000.5,
      timeLeftSeconds: 2160000.25,
      animals: 15234,
      plants: 902113,
      laws: 7,
      limitingHours: false,
      exhaustionAfterHours: 0,
    });
  });

  it("omits numeric enum ordinals and keeps the descriptive setting name", (): void => {
    const legacy = readFileSync(
      new URL("../../fixtures/eco/frontpage-0.7.json", import.meta.url),
      "utf8",
    );
    const page = parseEcoFrontpage(encode(legacy));
    expect(page).toMatchObject({
      description: "PPK Test",
      version: "0.7.8.6 beta",
      onlinePlayers: 0,
      skillSpecialization: "Medium",
      gamePort: 27505,
      webPort: 27022,
    });
    expect(page.category).toBeUndefined();
    expect(
      parseEcoFrontpage(encode('{"Info":{"SkillSpecializationSetting":2}}')).skillSpecialization,
    ).toBeUndefined();
    expect(() => parseEcoFrontpage(encode('{"Info":{"Category":1.5}}'))).toThrow(EcoProtocolError);
  });

  it("omits absent and null keys instead of inventing values", (): void => {
    expect(
      parseEcoFrontpage(encode('{"Info":{"Description":"Bare","OnlinePlayersNames":null}}')),
    ).toEqual({ description: "Bare" });
    expect(parseEcoFrontpage(encode('{"Info":{"OnlinePlayersNames":[]}}'))).toEqual({
      onlinePlayerNames: [],
    });
  });

  it("does not read inherited keys", (): void => {
    expect(parseEcoFrontpage(encode('{"Info":{}}'))).toEqual({});
    expect(
      Object.keys(parseEcoFrontpage(encode('{"Info":{"__proto__":{"Version":"x"}}}'))),
    ).toEqual([]);
  });

  it.each([
    "",
    "{",
    "[]",
    "{}",
    '{"Info":[]}',
    '{"Info":{"OnlinePlayers":-1}}',
    '{"Info":{"OnlinePlayers":1.5}}',
    '{"Info":{"OnlinePlayers":"2"}}',
    '{"Info":{"HasPassword":"false"}}',
    '{"Info":{"Description":7}}',
    '{"Info":{"GamePort":70000}}',
    '{"Info":{"OnlinePlayersNames":"Ada"}}',
    '{"Info":{"OnlinePlayersNames":[1]}}',
    '{"Info":{"TimeLeft":"soon"}}',
  ])("rejects malformed response %s", (body): void => {
    expect(() => parseEcoFrontpage(encode(body))).toThrow(EcoProtocolError);
  });

  it("rejects invalid UTF-8 and excessive nesting", (): void => {
    expect(() => parseEcoFrontpage(Uint8Array.of(0xff))).toThrow(EcoProtocolError);
    const nested = `{"Info":{"X":${"[".repeat(64)}${"]".repeat(64)}}}`;
    expect(() => parseEcoFrontpage(encode(nested))).toThrow(EcoProtocolError);
  });

  it("strips Unity rich-text tags from display text", (): void => {
    expect(
      plainEcoText("<color=#7CFC00><b>Green Valley</b></color> | <size=80%>Vanilla</size>"),
    ).toBe("Green Valley | Vanilla");
    expect(plainEcoText('<#ff0000>Red</color> <link="x">Link</link>')).toBe("Red Link");
    expect(plainEcoText("I <3 Eco & a < b")).toBe("I <3 Eco & a < b");
  });
});
