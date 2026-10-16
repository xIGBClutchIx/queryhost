import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseNetherNetStatus,
  queryNetherNetStatus,
} from "../../../src/protocols/minecraft-bedrock/nethernet.js";
import { executeWithDeadline } from "../../../src/runtime/execution.js";

const FIXTURE = readFileSync(
  new URL("../../fixtures/minecraft-bedrock/nethernet.json", import.meta.url),
);
const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("NetherNet HTTP status", (): void => {
  it("parses the live server fixture and preserves confirmed zero values", (): void => {
    expect(parseNetherNetStatus(FIXTURE)).toEqual({
      name: "Dedicated Server",
      protocol: 2193,
      version: "1.26.52",
      level: "Bedrock level",
      players: 0,
      maxPlayers: 10,
      gameType: 0,
    });
  });

  it("keeps capability-only and partial metadata sparse", (): void => {
    expect(parseNetherNetStatus(new Uint8Array())).toEqual({});
    expect(parseNetherNetStatus(encode("{}"))).toEqual({});
    expect(parseNetherNetStatus(encode('{"name":"","players":0,"extension":{"x":1}}'))).toEqual({
      name: "",
      players: 0,
    });
  });

  it.each([
    "null",
    "[]",
    "true",
    "{",
    '{"status":"ok"}',
    '{"players":null}',
    '{"players":-1}',
    '{"players":1.5}',
    '{"players":"0"}',
    '{"protocol":1e100}',
    '{"gameType":false}',
    '{"name":{}}',
    JSON.stringify({ version: "x".repeat(1025) }),
  ])("rejects malformed or unrelated metadata %s", (body): void => {
    expect(() => parseNetherNetStatus(encode(body))).toThrow();
  });

  it("rejects invalid UTF-8 and oversized bodies", (): void => {
    expect(() => parseNetherNetStatus(Uint8Array.of(0xff))).toThrow();
    expect(() => parseNetherNetStatus(new Uint8Array(16_385))).toThrow();
  });

  it.each([200, 204, 299, 302, 404, 500])(
    "checks HTTP status %s without following redirects",
    async (statusCode): Promise<void> => {
      const address = { address: "1.1.1.1", family: 4 } as const;
      const result = await executeWithDeadline({ timeoutMs: 1000 }, (scope) =>
        queryNetherNetStatus(
          {
            scope,
            address,
            target: { hostname: "play.example.com", port: 19132, addresses: [address] },
          },
          {
            exchange: (options) => {
              expect(options).toMatchObject({
                protocol: "http",
                path: "/v1/join",
                maxResponseBytes: 16384,
                address,
              });
              return Promise.resolve({ statusCode, data: FIXTURE, rttMs: 3, address, port: 19132 });
            },
          },
        ),
      );
      expect(result.ok).toBe(statusCode < 300);
    },
  );
});
