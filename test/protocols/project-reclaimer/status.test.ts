import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ProjectReclaimerProtocolError } from "../../../src/protocols/project-reclaimer/errors.js";
import {
  encodeProjectReclaimerStatusRequest,
  inspectProjectReclaimerStatusResponse,
  parseProjectReclaimerStatusResponse,
} from "../../../src/protocols/project-reclaimer/status.js";

function fixture(name: string): Uint8Array {
  return framed(
    readFileSync(new URL(`../../fixtures/project-reclaimer/${name}.json`, import.meta.url)),
  );
}

function framed(body: Uint8Array | string): Uint8Array {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const result = new Uint8Array(4 + bytes.byteLength);
  new DataView(result.buffer).setUint32(0, bytes.byteLength);
  result.set(bytes, 4);
  return result;
}

function protocolCode(code: ProjectReclaimerProtocolError["code"]): (error: Error) => boolean {
  return (error): boolean => error instanceof ProjectReclaimerProtocolError && error.code === code;
}

describe("Project Reclaimer status", (): void => {
  it("encodes the browser's fixed length-framed request", (): void => {
    expect(Buffer.from(encodeProjectReclaimerStatusRequest()).toString("hex")).toBe(
      "0000000c7b22737461747573223a327d",
    );
  });

  it("inspects the four-byte big-endian frame", (): void => {
    const response = fixture("status-plain");
    expect(inspectProjectReclaimerStatusResponse(response.subarray(0, 3))).toBe("incomplete");
    expect(inspectProjectReclaimerStatusResponse(response.subarray(0, -1))).toBe("incomplete");
    expect(inspectProjectReclaimerStatusResponse(response)).toBe("complete");
    expect(inspectProjectReclaimerStatusResponse(Uint8Array.from([...response, 0]))).toBe(
      "malformed",
    );
    expect(inspectProjectReclaimerStatusResponse(Uint8Array.of(0, 0, 0, 0))).toBe("malformed");
    expect(inspectProjectReclaimerStatusResponse(Uint8Array.of(0, 1, 0, 0))).toBe("too-large");
  });

  it("parses a server with a Forge map variant and no mods", (): void => {
    expect(parseProjectReclaimerStatusResponse(fixture("status-plain"))).toEqual({
      name: "[US] Big Maps 24/7",
      hostName: "Dedicated server",
      map: "Standoff",
      mode: "VIP",
      players: 0,
      capacity: 127,
      ready: true,
      passwordRequired: false,
      version: "0.9.23",
      variant: "Demolition Derby",
      mapVariant: "MINI Demo Derby",
      blocksVpn: true,
    });
  });

  it("parses mod entries and drops their unretained fields", (): void => {
    const status = parseProjectReclaimerStatusResponse(fixture("status-mods"));
    expect(status).toMatchObject({
      name: "👑 HB Slayer/Objectives 4v4 Custom Maps",
      map: "Goliath · Custom",
      mode: "Capture the Flag",
    });
    expect(status.mods?.length).toBeGreaterThan(2);
    expect(status.mods?.[0]).toEqual({
      id: "935fbb759499e33c68d393b343887e5fbab75bc072ce95ca8fc16db67430f867",
      title: "RAMP Spartan (characters)",
      maps: [
        {
          stem: "box-ramp-625d437a4ac87a28",
          digest: "34c1c64201dacb8748fd20c67edd8b1b02b7eef7b3ddf344248b034095e12058",
        },
      ],
      sizeBytes: 72_335_026,
      shared: true,
      customization: true,
      required: true,
    });
    expect(status.mods?.[2]).toEqual({
      id: "0c3667f1991de223206a1d76a74b1cac7515ca39512a697e6b16f07638c9f0c9",
      title: "Halo 3 Exalted Map Pack",
      maps: [
        {
          stem: "goliath",
          digest: "d9cd7116dab00ecc780ef5098739bf6730a358a00ab7cf00c2b9898bda246ecc",
        },
        {
          stem: "abyss",
          digest: "592a8cf6590d50da2998052f02dcd888501bae31531d500e2210113ac04b1da3",
        },
        {
          stem: "homefront",
          digest: "ffa1da4931ca505fc68c68d1bb57126fd2d48ce6f9f991411655374d44187423",
        },
      ],
      sizeBytes: 1_486_157_065,
      shared: true,
    });
  });

  it("parses ODST Firefight settings", (): void => {
    expect(parseProjectReclaimerStatusResponse(fixture("status-odst"))).toMatchObject({
      mode: "Firefight (Legendary)",
      odst: {
        mode: "firefight",
        mission: 6110,
        insertion: 4,
        difficulty: "legendary",
        variant: "odst_ff_classic",
      },
    });
  });

  it("parses player names, a ping limit, and ignores unknown fields", (): void => {
    const status = parseProjectReclaimerStatusResponse(fixture("status-players"));
    expect(status).toMatchObject({
      players: 3,
      capacity: 72,
      ready: false,
      passwordRequired: true,
      maxPingMs: 400,
      playerNames: ["Player One", "Player Two", "Player Three"],
    });
    expect(status.mods?.[0]).toEqual({
      id: "704a09b96a43a7ce7ae21d6a538289d7b7afbd765aaac2bfe2c7677d38d77fe0",
      title: "Map Pack",
      maps: [
        {
          stem: "s3d_reactor",
          digest: "1f95e0329202f4e8765f49c0089fed95d3e9083dd8d90cb5361e769748d96c11",
        },
      ],
      sizeBytes: 7_073_505_624,
      shared: true,
    });
    expect(Object.keys(status)).not.toContain("future_field");
  });

  it("keeps confirmed empty values and omits nulls", (): void => {
    expect(
      parseProjectReclaimerStatusResponse(
        framed('{"name":"","players":0,"player_names":[],"mods":[],"map":null,"odst":{}}'),
      ),
    ).toEqual({ name: "", players: 0, playerNames: [], mods: [], odst: {} });
  });

  it.each([
    ["a non-object root", "[]"],
    ["invalid JSON", "{"],
    ["a string count", '{"players":"3"}'],
    ["a negative count", '{"capacity":-1}'],
    ["a fractional ping limit", '{"max_ping":1.5}'],
    ["a non-boolean flag", '{"ready":1}'],
    ["a non-string player name", '{"player_names":[1]}'],
    ["a mod without an ID", '{"mods":[{"title":"x"}]}'],
    ["a mod map without a digest", '{"mods":[{"id":"a","maps":[{"stem":"x"}]}]}'],
    ["an ODST block that is not an object", '{"odst":"firefight"}'],
    ["an overlong name", JSON.stringify({ name: "x".repeat(1_025) })],
    [
      "too many player names",
      JSON.stringify({ player_names: Array.from({ length: 513 }, () => "p") }),
    ],
    ["excessive nesting", `{"future":${"[".repeat(9)}${"]".repeat(9)}}`],
  ])("rejects %s", (_label, body): void => {
    expect(() => parseProjectReclaimerStatusResponse(framed(body))).toThrow(
      expect.toSatisfy(protocolCode("MALFORMED_RESPONSE")),
    );
  });

  it("rejects invalid UTF-8 and size violations", (): void => {
    expect(() =>
      parseProjectReclaimerStatusResponse(framed(Uint8Array.of(0x7b, 0xff, 0x7d))),
    ).toThrow(expect.toSatisfy(protocolCode("MALFORMED_RESPONSE")));
    expect(() => parseProjectReclaimerStatusResponse(Uint8Array.of(0, 1, 0, 0))).toThrow(
      expect.toSatisfy(protocolCode("RESPONSE_TOO_LARGE")),
    );
  });
});
