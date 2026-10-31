import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  decodeStrictUtf8,
  decodeTruncatedUtf8,
  decodeUtf8OrLatin1,
} from "../../src/protocols/text.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("protocol text decoding", (): void => {
  it("decodes strict UTF-8 and keeps a leading BOM as text", (): void => {
    expect(decodeStrictUtf8(encode("Zoë 🙂"))).toBe("Zoë 🙂");
    expect(decodeStrictUtf8(Uint8Array.of(0xef, 0xbb, 0xbf, 0x61))).toBe("﻿a");
    expect(decodeStrictUtf8(Uint8Array.of(0x61, 0xe2, 0x82))).toBeUndefined();
  });

  it.each([
    ["a two-byte lead", [0x61, 0xc3], "a"],
    ["a three-byte prefix", [0x61, 0x62, 0xe2, 0x82], "ab"],
    ["a four-byte prefix", [0x61, 0xf0, 0x9f, 0x98], "a"],
  ])("drops %s cut at the end", (_label, bytes, expected): void => {
    expect(decodeTruncatedUtf8(Uint8Array.from(bytes))).toBe(expected);
  });

  it.each([
    ["a stray continuation byte at the end", [0x61, 0x80]],
    ["an overlong prefix", [0x61, 0xe0, 0x80]],
    ["a surrogate prefix", [0x61, 0xed, 0xa0]],
    ["a lead byte above U+10FFFF", [0x61, 0xf4, 0x90]],
    ["an invalid lead byte", [0x61, 0xc0]],
    ["an incomplete sequence before the end", [0xe2, 0x82, 0x61]],
  ])("still rejects %s", (_label, bytes): void => {
    expect(decodeTruncatedUtf8(Uint8Array.from(bytes))).toBeUndefined();
  });

  it("returns the leading text for any byte-truncated valid string", (): void => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), fc.nat(), (text, cut): void => {
        const bytes = encode(text);
        const end = bytes.byteLength === 0 ? 0 : cut % (bytes.byteLength + 1);
        const decoded = decodeTruncatedUtf8(bytes.subarray(0, end));
        expect(decoded).toBeDefined();
        expect(text.startsWith(decoded ?? "\0")).toBe(true);
        expect(encode(decoded ?? "").byteLength).toBeGreaterThan(end - 4);
      }),
      { numRuns: 300, seed: 0x51_14_2026 },
    );
  });

  it("does not carry a withheld tail into the next call", (): void => {
    expect(decodeTruncatedUtf8(Uint8Array.of(0x61, 0xe2, 0x82))).toBe("a");
    expect(decodeTruncatedUtf8(Uint8Array.of(0xac))).toBeUndefined();
  });

  it("falls back to Latin-1 only when the bytes are not valid UTF-8", (): void => {
    expect(decodeUtf8OrLatin1(encode("Café"))).toBe("Café");
    expect(decodeUtf8OrLatin1(Uint8Array.of(0x43, 0x61, 0x66, 0xe9))).toBe("Café");
  });
});
