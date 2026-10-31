import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { arma3RuleMetadata, parseArma3RulesPacket } from "../../src/protocols/arma3/rules.js";
import { parseA2sInfoPacket } from "../../src/protocols/a2s/info.js";
import { A2S_MAX_FRAGMENTS, reconstructA2sResponse } from "../../src/protocols/a2s/split.js";
import { dayZRuleMetadata, parseDayZRulesPacket } from "../../src/protocols/dayz/rules.js";
import { rulesPacket, sourceInfoPacket, type SourceInfoFields } from "../helpers/a2s-packets.js";
import { MetadataWriter, metadataPages } from "../helpers/bohemia-pages.js";

const PROPERTY_OPTIONS = Object.freeze({ numRuns: 200, seed: 0x51_14_2026 });
const SERVER_TYPES = { d: "dedicated", l: "listen", p: "proxy" } as const;
const ENVIRONMENTS = { l: "linux", w: "windows", m: "macos" } as const;

// A2S strings are null-terminated, so generated text must not contain U+0000.
const cText = fc.string({ unit: "grapheme", maxLength: 24 }).filter((text) => !text.includes("\0"));
const uint8 = fc.integer({ min: 0, max: 0xff });
const uint16 = fc.integer({ min: 0, max: 0xffff });
const uint64 = fc.bigInt({ min: 0n, max: 0xffff_ffff_ffff_ffffn });

const sourceInfoFields = fc.record(
  {
    protocol: uint8,
    name: cText,
    map: cText,
    folder: cText,
    game: cText,
    appId: fc.oneof(uint16, fc.constant(2_400)),
    players: uint8,
    maxPlayers: uint8,
    bots: uint8,
    serverType: fc.constantFrom("d", "l", "p"),
    environment: fc.constantFrom("l", "w", "m"),
    password: fc.boolean(),
    vac: fc.boolean(),
    version: cText,
    port: uint16,
    steamId: uint64,
    sourceTv: fc.record({ port: uint16, name: cText }),
    keywords: cText,
    gameId: uint64,
  },
  // Every extra-data field is optional, so the generator covers every EDF combination.
  { requiredKeys: ["protocol", "name", "map", "folder", "game", "appId", "version"] },
);

function withShip(
  fields: SourceInfoFields,
  ship: readonly [number, number, number],
): SourceInfoFields {
  return fields.appId === 2_400 ? { ...fields, ship } : fields;
}

describe("encode → parse round trips", (): void => {
  it("parses every A2S Info EDF combination back to the encoded fields", (): void => {
    fc.assert(
      fc.property(sourceInfoFields, fc.tuple(uint8, uint8, uint8), (generated, ship): void => {
        const fields = withShip(generated, ship);
        const packet = parseA2sInfoPacket(sourceInfoPacket(fields));
        const flags =
          (fields.port === undefined ? 0 : 0x80) |
          (fields.steamId === undefined ? 0 : 0x10) |
          (fields.sourceTv === undefined ? 0 : 0x40) |
          (fields.keywords === undefined ? 0 : 0x20) |
          (fields.gameId === undefined ? 0 : 0x01);
        expect(packet).toEqual({
          kind: "info",
          info: {
            format: "source",
            protocol: fields.protocol,
            name: fields.name,
            map: fields.map,
            folder: fields.folder,
            game: fields.game,
            appId: fields.appId,
            players: fields.players ?? 0,
            maxPlayers: fields.maxPlayers ?? 16,
            bots: fields.bots ?? 0,
            serverType: SERVER_TYPES[fields.serverType ?? "d"],
            environment: ENVIRONMENTS[fields.environment ?? "l"],
            password: fields.password === true,
            vac: fields.vac === true,
            ...(fields.ship === undefined
              ? {}
              : {
                  ship: {
                    mode: fields.ship[0],
                    witnesses: fields.ship[1],
                    duration: fields.ship[2],
                  },
                }),
            version: fields.version,
            ...(flags === 0 ? {} : { extraDataFlags: flags }),
            ...(fields.port === undefined ? {} : { port: fields.port }),
            ...(fields.steamId === undefined ? {} : { steamId: fields.steamId }),
            ...(fields.sourceTv === undefined ? {} : { sourceTv: fields.sourceTv }),
            ...(fields.keywords === undefined ? {} : { keywords: fields.keywords }),
            ...(fields.gameId === undefined ? {} : { gameId: fields.gameId }),
          },
        });
      }),
      PROPERTY_OPTIONS,
    );
  });

  const bohemiaString = fc
    .string({ unit: "grapheme", maxLength: 40 })
    .filter((text) => new TextEncoder().encode(text).byteLength <= 0xff);
  const dayZMod = fc.record({
    hash: fc.integer({ min: 0, max: 0xffff_ffff }),
    workshopId: fc.bigInt({ min: 0n, max: 0xffff_ffffn }),
    name: bohemiaString,
  });
  const dayZMetadata = fc.record({
    mods: fc.array(dayZMod, { maxLength: 12 }),
    signatures: fc.array(bohemiaString, { maxLength: 4 }),
    description: fc.option(bohemiaString, { nil: undefined }),
    pageSize: fc.integer({ min: 1, max: 124 }),
  });

  it("escapes, pages, and parses DayZ metadata back to the encoded values", (): void => {
    fc.assert(
      fc.property(dayZMetadata, (metadata): void => {
        const writer = new MetadataWriter().uint8(2).uint8(0).uint16(0).uint8(metadata.mods.length);
        for (const mod of metadata.mods) {
          writer.uint32(mod.hash).uint8(4).uint32(Number(mod.workshopId)).string(mod.name);
        }
        writer.uint8(metadata.signatures.length);
        for (const signature of metadata.signatures) {
          writer.string(signature);
        }
        if (metadata.description !== undefined) {
          writer.string(metadata.description);
        }
        const pages = metadataPages(writer.build(), metadata.pageSize);
        // DayZ accepts at most 32 pages; larger inputs belong to the bounded-failure properties.
        fc.pre(pages.length <= 32);
        const packet = parseDayZRulesPacket(rulesPacket([["island", "chernarusplus"], ...pages]));
        if (packet.kind !== "data") {
          throw new Error("Expected DayZ Rules data.");
        }
        expect(packet.value).toEqual({ island: "chernarusplus" });
        expect(dayZRuleMetadata(packet.value)).toEqual({
          protocol: 2,
          ...(metadata.description === undefined ? {} : { description: metadata.description }),
          mods: metadata.mods.map((mod) => ({
            name: mod.name,
            ...(mod.workshopId === 0n ? {} : { workshopId: mod.workshopId.toString() }),
            hash: mod.hash,
          })),
          signatures: metadata.signatures,
        });
      }),
      PROPERTY_OPTIONS,
    );
  });

  it("escapes, pages, and parses Arma 3 metadata back to the encoded values", (): void => {
    const arma3Mod = fc.oneof(
      dayZMod.map((mod) => ({ kind: "mod" as const, ...mod })),
      fc.record({
        kind: fc.constant("creator-dlc" as const),
        hash: fc.integer({ min: 0, max: 0xffff_ffff }),
        appId: fc.integer({ min: 0, max: 0xffff_ffff }),
      }),
    );
    fc.assert(
      fc.property(
        fc.array(arma3Mod, { maxLength: 12 }),
        fc.integer({ min: 0, max: 0xffff }),
        fc.integer({ min: 1, max: 124 }),
        (mods, dlcMask, pageSize): void => {
          const writer = new MetadataWriter().uint8(3).uint8(0).uint16(dlcMask).uint8(0).uint8(0);
          const dlc: { flag: number; hash: number }[] = [];
          for (let flag = 1; flag <= 0x8000; flag <<= 1) {
            if ((dlcMask & flag) !== 0) {
              dlc.push({ flag, hash: flag ^ 0x5a5a });
              writer.uint32(flag ^ 0x5a5a);
            }
          }
          writer.uint8(mods.length);
          for (const mod of mods) {
            writer.uint32(mod.hash);
            if (mod.kind === "creator-dlc") {
              writer.uint8(19).uint32(mod.appId);
            } else {
              writer.uint8(4).uint32(Number(mod.workshopId)).string(mod.name);
            }
          }
          writer.uint8(0);
          const pages = metadataPages(writer.build(), pageSize);
          fc.pre(pages.length <= 255);
          const packet = parseArma3RulesPacket(rulesPacket(pages));
          if (packet.kind !== "data") {
            throw new Error("Expected Arma 3 Rules data.");
          }
          expect(arma3RuleMetadata(packet.value)).toEqual({
            protocol: 3,
            dlc,
            mods: mods.map((mod) =>
              mod.kind === "creator-dlc"
                ? mod
                : {
                    kind: "mod",
                    name: mod.name,
                    ...(mod.workshopId === 0n ? {} : { workshopId: mod.workshopId.toString() }),
                    hash: mod.hash,
                  },
            ),
            signatures: [],
          });
        },
      ),
      PROPERTY_OPTIONS,
    );
  });
});

describe("split reconstruction", (): void => {
  function sourceFragment(count: number, index: number, payload: Uint8Array): Uint8Array {
    const result = new Uint8Array(12 + payload.byteLength);
    result.set(Uint8Array.of(0xfe, 0xff, 0xff, 0xff));
    const view = new DataView(result.buffer);
    view.setUint32(4, 0x1234, true);
    result[8] = count;
    result[9] = index;
    view.setUint16(10, 1_248, true);
    result.set(payload, 12);
    return result;
  }

  it("gives the same response for shuffled and duplicated identical fragments", async (): Promise<void> => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.uint8Array({ minLength: 1, maxLength: 64 }), {
          // A split response always has at least two fragments.
          minLength: 2,
          maxLength: A2S_MAX_FRAGMENTS,
        }),
        fc.array(fc.nat(), { maxLength: 15 }),
        fc.nat(),
        async (generated, duplicates, shuffleSeed): Promise<void> => {
          // The reassembled response is itself a single-packet response with its -1 header.
          const chunks = generated.map((chunk, index) =>
            index === 0 ? Uint8Array.of(0xff, 0xff, 0xff, 0xff, ...chunk) : chunk,
          );
          const fragments = chunks.map((chunk, index) =>
            sourceFragment(chunks.length, index, chunk),
          );
          // Exact duplicates may appear anywhere; the datagram budget stays within 30.
          const datagrams = [
            ...fragments,
            ...duplicates.map((pick) => Uint8Array.from(fragments[pick % fragments.length] ?? [])),
          ];
          let seed = shuffleSeed;
          for (let index = datagrams.length - 1; index > 0; index -= 1) {
            seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
            const other = seed % (index + 1);
            const current = datagrams[index];
            const swap = datagrams[other];
            if (current !== undefined && swap !== undefined) {
              datagrams[index] = swap;
              datagrams[other] = current;
            }
          }
          const expected = Uint8Array.from(chunks.flatMap((chunk) => [...chunk]));
          expect(await reconstructA2sResponse(datagrams)).toEqual(expected);
          expect(await reconstructA2sResponse(fragments)).toEqual(expected);
        },
      ),
      { ...PROPERTY_OPTIONS, numRuns: 150 },
    );
  });
});
