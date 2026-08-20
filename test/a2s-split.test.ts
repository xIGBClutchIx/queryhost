import { Buffer } from "node:buffer";
import { crc32 } from "node:zlib";

import { describe, expect, it } from "vitest";

import { A2sProtocolError } from "../src/protocols/a2s/errors.js";
import {
  A2S_MAX_DATAGRAMS,
  A2S_MAX_RESPONSE_BYTES,
  isA2sResponseComplete,
  reconstructA2sResponse,
  type A2sSplitDependencies,
} from "../src/protocols/a2s/split.js";

const SPLIT_HEADER = Uint8Array.of(0xfe, 0xff, 0xff, 0xff);
const SINGLE_HEADER = Uint8Array.of(0xff, 0xff, 0xff, 0xff);

function sourceFragment(
  requestId: number,
  count: number,
  index: number,
  payload: Uint8Array,
  splitSize = 1_248,
): Uint8Array {
  const result = new Uint8Array(12 + payload.byteLength);
  result.set(SPLIT_HEADER);
  const view = new DataView(result.buffer);
  view.setUint32(4, requestId, true);
  result[8] = count;
  result[9] = index;
  view.setUint16(10, splitSize, true);
  result.set(payload, 12);
  return result;
}

function compressedSourceFragment(
  requestId: number,
  count: number,
  index: number,
  payload: Uint8Array,
  size: number,
  checksum: number,
  modernHeader = false,
): Uint8Array {
  const metadataBytes = index === 0 ? 8 : 0;
  const headerBytes = modernHeader ? 12 : 10;
  const result = new Uint8Array(headerBytes + metadataBytes + payload.byteLength);
  result.set(SPLIT_HEADER);
  const view = new DataView(result.buffer);
  view.setUint32(4, requestId | 0x8000_0000, true);
  result[8] = count;
  result[9] = index;
  if (modernHeader) {
    view.setUint16(10, 1_248, true);
  }
  if (index === 0) {
    view.setUint32(headerBytes, size, true);
    view.setUint32(headerBytes + 4, checksum, true);
  }
  result.set(payload, headerBytes + metadataBytes);
  return result;
}

function goldSourceFragment(
  requestId: number,
  count: number,
  index: number,
  payload: Uint8Array,
): Uint8Array {
  const result = new Uint8Array(9 + payload.byteLength);
  result.set(SPLIT_HEADER);
  new DataView(result.buffer).setUint32(4, requestId, true);
  result[8] = (index << 4) | count;
  result.set(payload, 9);
  return result;
}

function protocolCode(code: A2sProtocolError["code"]): (error: Error) => boolean {
  return (error: Error): boolean => error instanceof A2sProtocolError && error.code === code;
}

describe("A2S split-packet reconstruction", (): void => {
  it("passes through exactly one single-packet response", async (): Promise<void> => {
    const packet = Uint8Array.of(...SINGLE_HEADER, 0x41, 1, 2, 3, 4);

    expect(isA2sResponseComplete([packet])).toBe(true);
    await expect(reconstructA2sResponse([packet])).resolves.toEqual(packet);
  });

  it("reconstructs out-of-order Source fragments and ignores exact duplicates", async (): Promise<void> => {
    const payload = Uint8Array.of(...SINGLE_HEADER, 0x49, 1, 2, 3, 4, 5, 6);
    const fragments = [
      sourceFragment(123, 3, 0, payload.subarray(0, 4)),
      sourceFragment(123, 3, 1, payload.subarray(4, 7)),
      sourceFragment(123, 3, 2, payload.subarray(7)),
    ] as const;
    const received = [fragments[2], fragments[1], fragments[1], fragments[0]];

    expect(isA2sResponseComplete(received.slice(0, 3))).toBe(false);
    expect(isA2sResponseComplete(received)).toBe(true);
    await expect(reconstructA2sResponse(received)).resolves.toEqual(payload);
  });

  it("reconstructs out-of-order GoldSource fragments", async (): Promise<void> => {
    const payload = Uint8Array.of(...SINGLE_HEADER, 0x6d, 9, 8, 7, 6);
    const fragments = [
      goldSourceFragment(456, 2, 0, payload.subarray(0, 5)),
      goldSourceFragment(456, 2, 1, payload.subarray(5)),
    ] as const;

    expect(isA2sResponseComplete([fragments[1], fragments[0]])).toBe(true);
    await expect(reconstructA2sResponse([fragments[1], fragments[0]])).resolves.toEqual(payload);
  });

  it("rejects conflicting duplicate indexes and response identifiers", async (): Promise<void> => {
    const first = sourceFragment(123, 2, 0, SINGLE_HEADER);
    const conflict = sourceFragment(123, 2, 0, Uint8Array.of(0xff, 0xff, 0xff, 0xfe));
    const otherResponse = sourceFragment(124, 2, 1, Uint8Array.of(0x49));

    expect(() => isA2sResponseComplete([first, conflict])).toThrow(
      expect.objectContaining({ code: "FRAGMENT_CONFLICT" }),
    );
    await expect(reconstructA2sResponse([first, otherResponse])).rejects.toSatisfy(
      protocolCode("FRAGMENT_CONFLICT"),
    );
  });

  it("rejects incomplete responses and bounded fragment floods", async (): Promise<void> => {
    const first = sourceFragment(123, 2, 0, SINGLE_HEADER);
    await expect(reconstructA2sResponse([first])).rejects.toSatisfy(
      protocolCode("MISSING_FRAGMENT"),
    );

    const flood = Array.from({ length: A2S_MAX_DATAGRAMS + 1 }, () => first);
    expect(() => isA2sResponseComplete(flood)).toThrow(
      expect.objectContaining({ code: "FRAGMENT_LIMIT" }),
    );
  });

  it("decompresses bzip2 data and validates its declared size and CRC32", async (): Promise<void> => {
    const response = new TextEncoder().encode("hello wasm-bz2");
    const compressed = Uint8Array.from(
      Buffer.from(
        "QlpoOTFBWSZTWX78x88AAAMZgEACEAAyRoiQIAAiCMmmxCAaAMxKhYKglaLuSKcKEg/fmPng",
        "base64",
      ),
    );
    const splitAt = Math.ceil(compressed.byteLength / 2);
    const checksum = crc32(response);
    const fragments = [
      compressedSourceFragment(
        789,
        2,
        0,
        compressed.subarray(0, splitAt),
        response.byteLength,
        checksum,
      ),
      compressedSourceFragment(
        789,
        2,
        1,
        compressed.subarray(splitAt),
        response.byteLength,
        checksum,
      ),
    ] as const;
    const modernFragments = [
      compressedSourceFragment(
        790,
        2,
        0,
        compressed.subarray(0, splitAt),
        response.byteLength,
        checksum,
        true,
      ),
      compressedSourceFragment(
        790,
        2,
        1,
        compressed.subarray(splitAt),
        response.byteLength,
        checksum,
        true,
      ),
    ] as const;

    await expect(reconstructA2sResponse([fragments[1], fragments[0]])).resolves.toEqual(response);
    await expect(reconstructA2sResponse([modernFragments[1], modernFragments[0]])).resolves.toEqual(
      response,
    );
  });

  it("rejects checksum mismatch, corrupt streams, and declared decompression bombs", async (): Promise<void> => {
    const corrupt = Uint8Array.of(0x42, 0x5a, 0x68, 0, 1, 2, 3);
    const checksumMismatch = [
      compressedSourceFragment(10, 2, 0, corrupt, 5, 123),
      compressedSourceFragment(10, 2, 1, Uint8Array.of(4), 5, 123),
    ] as const;
    await expect(reconstructA2sResponse(checksumMismatch)).rejects.toSatisfy(
      protocolCode("DECOMPRESSION_FAILED"),
    );

    let decompressionCalls = 0;
    const bombDependencies: A2sSplitDependencies = {
      decompress(): Promise<Uint8Array> {
        decompressionCalls += 1;
        return Promise.resolve(new Uint8Array());
      },
    };
    const bomb = [
      compressedSourceFragment(
        11,
        2,
        0,
        Uint8Array.of(0x42, 0x5a, 0x68, 1),
        A2S_MAX_RESPONSE_BYTES + 1,
        0,
      ),
      compressedSourceFragment(11, 2, 1, Uint8Array.of(2), A2S_MAX_RESPONSE_BYTES + 1, 0),
    ] as const;
    await expect(reconstructA2sResponse(bomb, bombDependencies)).rejects.toSatisfy(
      protocolCode("RESPONSE_TOO_LARGE"),
    );
    expect(decompressionCalls).toBe(0);

    const wrongChecksumDependencies: A2sSplitDependencies = {
      decompress(): Promise<Uint8Array> {
        return Promise.resolve(Uint8Array.of(...SINGLE_HEADER, 0x49));
      },
    };
    const wrongChecksum = [
      compressedSourceFragment(12, 2, 0, Uint8Array.of(0x42, 0x5a, 0x68, 1), 5, 0),
      compressedSourceFragment(12, 2, 1, Uint8Array.of(2), 5, 0),
    ] as const;
    await expect(
      reconstructA2sResponse(wrongChecksum, wrongChecksumDependencies),
    ).rejects.toSatisfy(protocolCode("CHECKSUM_MISMATCH"));
  });
});
