/** Shared deterministic boundaries for independent game-profile tests. */

import { readFile } from "node:fs/promises";

import { vi } from "vitest";

import type { QueryDependencies } from "../../src/client.js";
import type { A2sExchangeDependencies } from "../../src/protocols/a2s/network.js";
import type { DnsAddressRecord, DnsResolver } from "../../src/target.js";
import type { UdpCollectionOptions, UdpCollectionResult } from "../../src/transports/udp.js";

type A2sFixtureGame = "project-zomboid" | "seven-days-to-die";

const PUBLIC_ADDRESS: DnsAddressRecord = Object.freeze({
  address: "93.184.216.34",
  family: 4,
});

async function fixture(game: A2sFixtureGame, name: string): Promise<Uint8Array> {
  const text = await readFile(new URL(`../fixtures/${game}/${name}.hex`, import.meta.url), "utf8");
  const compact = text.replaceAll(/\s/gu, "");
  if (compact.length === 0 || compact.length % 2 !== 0 || /[^0-9a-f]/iu.test(compact)) {
    throw new Error(`Invalid ${game} hex fixture: ${name}`);
  }
  const bytes = new Uint8Array(compact.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function resolver(addresses: readonly DnsAddressRecord[] = [PUBLIC_ADDRESS]): DnsResolver {
  return {
    resolveAddresses: vi.fn(() => Promise.resolve(addresses)),
    resolveSrv: vi.fn(() => Promise.resolve([])),
  };
}

export function packetType(options: UdpCollectionOptions): number {
  const type = options.request[4];
  if (type === undefined) {
    throw new Error("The A2S request is missing its type byte.");
  }
  return type;
}

function response(
  options: UdpCollectionOptions,
  data: Uint8Array,
  rttMs: number,
): UdpCollectionResult {
  return {
    datagrams: Object.freeze([data]),
    rttMs,
    address: options.address,
    port: options.target.port,
  };
}

export async function fixtureA2s(game: A2sFixtureGame): Promise<A2sExchangeDependencies> {
  const [info, players, rules] = await Promise.all([
    fixture(game, "info"),
    fixture(game, "players"),
    fixture(game, "rules"),
  ]);
  return {
    collect(options): Promise<UdpCollectionResult> {
      switch (packetType(options)) {
        case 0x54:
          return Promise.resolve(response(options, info, 8));
        case 0x55:
          return Promise.resolve(response(options, players, 5));
        case 0x56:
          return Promise.resolve(response(options, rules, 6));
        default:
          return Promise.reject(new Error("Unexpected A2S request type."));
      }
    },
  };
}

export function dependencies(
  a2s: A2sExchangeDependencies,
  dns: DnsResolver = resolver(),
): QueryDependencies {
  let calls = 0;
  return {
    resolver: dns,
    a2s,
    now(): number {
      calls += 1;
      return calls === 1 ? 100 : 125;
    },
  };
}
