import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { A2sProtocolError } from "../../../src/protocols/a2s/errors.js";
import { dayZRuleMetadata, parseDayZRulesPacket } from "../../../src/protocols/dayz/rules.js";

async function fixture(): Promise<Uint8Array> {
  const text = await readFile(new URL("../../fixtures/dayz/rules.hex", import.meta.url), "utf8");
  return Uint8Array.from(Buffer.from(text.replaceAll(/\s/gu, ""), "hex"));
}

describe("DayZ Rules metadata", (): void => {
  it("reassembles escaped pages and keeps direct string rules separate", async (): Promise<void> => {
    const packet = parseDayZRulesPacket(await fixture());
    if (packet.kind !== "data") {
      throw new Error("Expected DayZ Rules data.");
    }

    expect(packet.value).toEqual({
      allowedBuild: "0",
      clientPort: "2302",
      dedicated: "1",
      island: "ChernarusPlus",
      language: "65545",
      platform: "win",
      requiredBuild: "0",
      requiredVersion: "129",
      timeLeft: "15",
    });
    expect(dayZRuleMetadata(packet.value)).toEqual({
      protocol: 2,
      description: "Synthetic DayZ server",
      mods: [
        { name: "Community Framework", workshopId: "1559212036", hash: 1_218_956_183 },
        { name: "Fixture Mod", workshopId: "123456789", hash: 4_294_967_295 },
      ],
      signatures: ["dayz", "fixture"],
    });
  });

  it("rejects inconsistent page metadata before decoding", async (): Promise<void> => {
    const packet = await fixture();
    const secondPageIndex = 91;
    expect(packet[secondPageIndex]).toBe(2);
    packet[secondPageIndex] = 3;

    expect(() => parseDayZRulesPacket(packet)).toThrow(A2sProtocolError);
  });
});
