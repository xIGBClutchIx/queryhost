import { describe, expect, it, vi } from "vitest";

import type { QueryInput } from "../../src/contracts/query.js";
import type { DnsResolver } from "../../src/network/target.js";
import { queryWithDependencies } from "../../src/runtime/client.js";

/** Simulates an untyped JavaScript caller that bypasses the declared input type. */
function untyped(input: object | null | undefined): QueryInput {
  return input as QueryInput;
}

function resolver(): DnsResolver {
  return {
    resolveAddresses: vi.fn<DnsResolver["resolveAddresses"]>(),
    resolveSrv: vi.fn<DnsResolver["resolveSrv"]>(),
  };
}

const INVALID_INPUT = { code: "INVALID_INPUT", message: "The query input is invalid." };

describe("query input boundary", (): void => {
  it.each([
    ["an unknown game ID", { game: "nope", host: "play.example.com" }, "nope"],
    ["an inherited key", { game: "__proto__", host: "play.example.com" }, "__proto__"],
    ["an Object.prototype method", { game: "toString", host: "play.example.com" }, "toString"],
    ["a non-string game", { game: 42, host: "play.example.com" }, 42],
    ["a missing game", { host: "play.example.com" }, undefined],
  ])(
    "returns INVALID_INPUT for %s and echoes the supplied game",
    async (_name, input, game): Promise<void> => {
      const dns = resolver();
      const result = await queryWithDependencies(untyped(input), { resolver: dns, now: () => 0 });

      expect(result).toEqual({
        ok: false,
        game,
        error: INVALID_INPUT,
        durationMs: 0,
        sources: [],
        warnings: [],
      });
      expect(dns.resolveAddresses).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("returns INVALID_INPUT for %s input", async (_name, input): Promise<void> => {
    const result = await queryWithDependencies(untyped(input), { now: () => 0 });

    expect(result).toMatchObject({ ok: false, error: INVALID_INPUT, sources: [] });
    expect(result.game).toBeUndefined();
  });

  it.each([
    ["a non-string host", { game: "rust", host: 42 }],
    ["a missing host", { game: "rust" }],
    ["a non-AbortSignal signal", { game: "rust", host: "play.example.com", signal: {} }],
  ])("returns INVALID_INPUT for %s", async (_name, input): Promise<void> => {
    const dns = resolver();
    const result = await queryWithDependencies(untyped(input), { resolver: dns, now: () => 0 });

    expect(result).toMatchObject({ ok: false, game: "rust", error: INVALID_INPUT, sources: [] });
    expect(dns.resolveAddresses).not.toHaveBeenCalled();
  });
});
