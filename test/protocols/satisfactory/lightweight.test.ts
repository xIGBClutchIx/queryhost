import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SatisfactoryProtocolError } from "../../../src/protocols/satisfactory/errors.js";
import {
  encodeSatisfactoryPoll,
  parseSatisfactoryState,
} from "../../../src/protocols/satisfactory/lightweight.js";

const COOKIE = 0x0102_0304_0506_0708n;
const FIXTURE = Uint8Array.from(
  Buffer.from(
    readFileSync(
      new URL("../../fixtures/satisfactory/lightweight.hex", import.meta.url),
      "utf8",
    ).trim(),
    "hex",
  ),
);

function malformed(packet: Uint8Array): boolean {
  try {
    parseSatisfactoryState(packet, COOKIE);
    return false;
  } catch (error) {
    return error instanceof SatisfactoryProtocolError && error.code === "MALFORMED_RESPONSE";
  }
}

describe("Satisfactory Lightweight Query", (): void => {
  it("encodes the versioned poll envelope in little-endian order", (): void => {
    expect(Buffer.from(encodeSatisfactoryPoll(COOKIE)).toString("hex")).toBe(
      "d5f60001080706050403020101",
    );
  });

  it("parses bounded status fields and ignores future substate IDs", (): void => {
    expect(parseSatisfactoryState(FIXTURE, COOKIE)).toEqual({
      cookie: COOKIE,
      state: "playing",
      stateCode: 3,
      serverNetCl: 12_345_678,
      serverFlags: "1",
      modded: true,
      subStates: [
        { id: 0, version: 0x1234 },
        { id: 1, version: 2 },
        { id: 3, version: 65_535 },
      ],
      serverName: "Factory α",
    });
  });

  it("rejects correlation, framing, length, UTF-8, and state violations", (): void => {
    expect(() => parseSatisfactoryState(FIXTURE, COOKIE + 1n)).toThrow(SatisfactoryProtocolError);
    for (const offset of [0, 2, 3, 12, FIXTURE.length - 1]) {
      const packet = Uint8Array.from(FIXTURE);
      packet[offset] = 0;
      expect(malformed(packet)).toBe(true);
    }
    expect(malformed(FIXTURE.slice(0, -1))).toBe(true);
    const invalidUtf8 = Uint8Array.from(FIXTURE);
    invalidUtf8[invalidUtf8.length - 2] = 0xff;
    expect(malformed(invalidUtf8)).toBe(true);
  });

  it("rejects out-of-range cookies and oversized server names", (): void => {
    expect(() => encodeSatisfactoryPoll(-1n)).toThrow(SatisfactoryProtocolError);
    const packet = Uint8Array.from(FIXTURE);
    const nameLengthOffset = packet.length - 13;
    new DataView(packet.buffer).setUint16(nameLengthOffset, 1_025, true);
    expect(() => parseSatisfactoryState(packet, COOKIE)).toThrowError(
      expect.objectContaining({ code: "RESPONSE_TOO_LARGE" }),
    );
  });
});
