import { describe, expect, it } from "vitest";

import { A2sProtocolError } from "../../../src/protocols/a2s/errors.js";
import { arma3RuleMetadata, parseArma3RulesPacket } from "../../../src/protocols/arma3/rules.js";
import { rulesPacket } from "../../helpers/a2s-packets.js";
import { MetadataWriter, metadataPages } from "../../helpers/bohemia-pages.js";

function fullMetadata(): Uint8Array {
  return (
    new MetadataWriter()
      .uint8(3)
      .uint8(0)
      // Marksmen (0x2) and Art of War (0x1000).
      .uint16(0x1002)
      // Veteran difficulty with AI level 1, advanced flight model off, third person on.
      .uint8(0b1100_1010)
      .uint8(1)
      .uint32(0x0102_03ff)
      .uint32(7)
      .uint8(3)
      .uint32(0xffff_ffff)
      .uint8(4)
      .uint32(450_814_997)
      .string("CBA_A3")
      .uint32(9)
      .uint8(1)
      .uint8(0)
      .string("@local")
      .uint32(11)
      .uint8(19)
      .uint32(1_227_700)
      .uint8(2)
      .string("a3")
      .string("cba_v3")
      .build()
  );
}

function parse(entries: Parameters<typeof rulesPacket>[0]) {
  const packet = parseArma3RulesPacket(rulesPacket(entries));
  if (packet.kind !== "data") {
    throw new Error("Expected Arma 3 Rules data.");
  }
  return { rules: packet.value, metadata: arma3RuleMetadata(packet.value) };
}

describe("Arma 3 Rules metadata", (): void => {
  it("decodes difficulty, DLC hashes, mods, Creator DLC, and signatures", (): void => {
    const { rules, metadata } = parse(metadataPages(fullMetadata(), 16));

    expect(rules).toEqual({});
    expect(metadata).toEqual({
      protocol: 3,
      difficulty: {
        level: 2,
        aiLevel: 1,
        advancedFlightModel: false,
        thirdPerson: true,
        crosshair: true,
      },
      dlc: [
        { flag: 0x2, hash: 0x0102_03ff },
        { flag: 0x1000, hash: 7 },
      ],
      mods: [
        { kind: "mod", name: "CBA_A3", workshopId: "450814997", hash: 0xffff_ffff },
        { kind: "mod", name: "@local", hash: 9 },
        { kind: "creator-dlc", appId: 1_227_700, hash: 11 },
      ],
      signatures: ["a3", "cba_v3"],
    });
  });

  it("keeps direct string rules beside the pages and reads a trailing description", (): void => {
    const payload = new MetadataWriter()
      .uint8(3)
      .uint8(0)
      .uint16(0)
      .uint8(0)
      .uint8(0)
      .uint8(0)
      .uint8(0)
      .string("Weekend ops")
      .build();
    const { rules, metadata } = parse([["mission", "Antistasi"], ...metadataPages(payload)]);

    expect(rules).toEqual({ mission: "Antistasi" });
    expect(metadata).toEqual({
      protocol: 3,
      dlc: [],
      mods: [],
      signatures: [],
      description: "Weekend ops",
    });
  });

  it("accepts more pages than DayZ's bound", (): void => {
    const writer = new MetadataWriter().uint8(3).uint8(0).uint16(0).uint8(0).uint8(0).uint8(40);
    for (let index = 0; index < 40; index += 1) {
      writer
        .uint32(index + 2)
        .uint8(4)
        .uint32(1_000 + index)
        .string(`@mod_${String(index)}`);
    }
    const pages = metadataPages(writer.uint8(0).build(), 16);

    expect(pages.length).toBeGreaterThan(32);
    expect(parse(pages).metadata?.mods).toHaveLength(40);
  });

  it.each([
    ["DayZ's protocol version", new MetadataWriter().uint8(2).uint8(0).uint16(0).uint8(0).uint8(0)],
    [
      "an unknown mod ID width",
      new MetadataWriter()
        .uint8(3)
        .uint8(0)
        .uint16(0)
        .uint8(0)
        .uint8(0)
        .uint8(1)
        .uint32(1)
        .uint8(3),
    ],
    [
      "a truncated DLC hash list",
      new MetadataWriter().uint8(3).uint8(0).uint16(0x3).uint8(0).uint8(0).uint32(1),
    ],
  ])("rejects %s", (_name, writer): void => {
    expect(() => parseArma3RulesPacket(rulesPacket(metadataPages(writer.build())))).toThrow(
      A2sProtocolError,
    );
  });
});
