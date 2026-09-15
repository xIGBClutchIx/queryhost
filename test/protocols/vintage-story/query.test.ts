import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { VintageStoryProtocolError } from "../../../src/protocols/vintage-story/errors.js";
import {
  encodeVintageStoryQueryRequest,
  inspectVintageStoryQueryResponse,
  parseVintageStoryQueryResponse,
} from "../../../src/protocols/vintage-story/query.js";

async function fixture(name: string): Promise<Uint8Array> {
  const source = await readFile(
    new URL(`../../fixtures/vintage-story/${name}.hex`, import.meta.url),
    "utf8",
  );
  return Uint8Array.from(Buffer.from(source.trim(), "hex"));
}

function protocolCode(code: VintageStoryProtocolError["code"]): (error: Error) => boolean {
  return (error): boolean => error instanceof VintageStoryProtocolError && error.code === code;
}

describe("Vintage Story server query", (): void => {
  it("encodes the official framed empty query packet", (): void => {
    expect(Buffer.from(encodeVintageStoryQueryRequest()).toString("hex")).toBe("00000004080f5200");
  });

  it("parses the current stock liveness acknowledgement without invented fields", async (): Promise<void> => {
    const response = await fixture("query-complete");
    expect(inspectVintageStoryQueryResponse(response.slice(0, 3))).toBe("incomplete");
    expect(inspectVintageStoryQueryResponse(response.slice(0, -1))).toBe("incomplete");
    expect(inspectVintageStoryQueryResponse(response)).toBe("complete");
    expect(parseVintageStoryQueryResponse(response)).toEqual({ kind: "liveness" });
  });

  it("parses every field in a compatible status answer", async (): Promise<void> => {
    expect(parseVintageStoryQueryResponse(await fixture("query-answer"))).toEqual({
      kind: "status",
      name: "Temporal Haven",
      motd: "Welcome",
      playersOnline: 3,
      playersMax: 16,
      gameMode: "survival",
      password: true,
      version: "1.22.7",
    });
  });

  it("preserves omitted status fields and skips a bounded extension field", (): void => {
    const response = Uint8Array.from(
      Buffer.from("00000013d0051ce2010d3a06312e32322e374203010203", "hex"),
    );
    expect(parseVintageStoryQueryResponse(response)).toEqual({
      kind: "status",
      version: "1.22.7",
    });
  });

  it("rejects unrelated disconnects, impossible counts, and trailing frames", async (): Promise<void> => {
    const acknowledgement = await fixture("query-complete");
    const unrelated = Uint8Array.from(acknowledgement);
    unrelated[unrelated.byteLength - 1] = 0x21;
    expect(() => parseVintageStoryQueryResponse(unrelated)).toThrow(
      expect.toSatisfy(protocolCode("MALFORMED_RESPONSE")),
    );

    const status = await fixture("query-answer");
    const impossible = Uint8Array.from(status);
    const online = impossible.indexOf(0x18, 10);
    impossible[online + 1] = 17;
    expect(() => parseVintageStoryQueryResponse(impossible)).toThrow(
      expect.toSatisfy(protocolCode("MALFORMED_RESPONSE")),
    );

    expect(inspectVintageStoryQueryResponse(Uint8Array.from([...status, 0]))).toBe("malformed");
  });

  it("rejects compressed and excessive frame declarations before allocation", (): void => {
    expect(inspectVintageStoryQueryResponse(Uint8Array.of(0x80, 0, 0, 1, 0))).toBe("malformed");
    expect(inspectVintageStoryQueryResponse(Uint8Array.of(0, 0, 0x20, 0))).toBe("too-large");
  });
});
