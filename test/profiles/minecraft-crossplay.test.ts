import { describe, expect, it } from "vitest";

import { bedrockCrossplay, javaCrossplay } from "../../src/profiles/minecraft-crossplay.js";

describe("Minecraft crossplay hints", (): void => {
  it.each(["Geyser-Spigot", "Geyser-Velocity", "geyser", "floodgate", "Floodgate-Bukkit"])(
    "recognises the %s bridge plugin",
    (name): void => {
      expect(javaCrossplay([{ name: "LuckPerms" }, { name, version: "2.4.1" }])).toEqual({
        crossplay: { bridge: "geyser", evidence: "query-plugins" },
      });
    },
  );

  it("omits the hint when plugins are unknown or show no bridge", (): void => {
    expect(javaCrossplay(undefined)).toEqual({});
    expect(javaCrossplay([])).toEqual({});
    expect(javaCrossplay([{ name: "GeyserFixes" }, { name: "ViaVersion" }])).toEqual({});
  });

  it.each(["Geyser", "Another Geyser server.", " Geyser "])(
    "recognises the Geyser default sub-MOTD %j",
    (subMotd): void => {
      expect(bedrockCrossplay(subMotd)).toEqual({
        crossplay: { bridge: "geyser", evidence: "bedrock-sub-motd" },
      });
    },
  );

  it("does not treat level names that merely mention Geyser as evidence", (): void => {
    expect(bedrockCrossplay(undefined)).toEqual({});
    expect(bedrockCrossplay("Bedrock level")).toEqual({});
    expect(bedrockCrossplay("Geyser Valley")).toEqual({});
  });
});
