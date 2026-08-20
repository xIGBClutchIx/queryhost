/** IP parsing and fail-closed public-routability policy for untrusted query targets. */

import { isIP, isIPv4, isIPv6 } from "node:net";

type Ipv4Range = readonly [network: number, prefixLength: number];
type Ipv6Range = readonly [network: readonly number[], prefixLength: number];

// IANA IPv4 Special-Purpose Address Space, last reviewed 2026-08-20.
const BLOCKED_IPV4_RANGES: readonly Ipv4Range[] = [
  [0x00000000, 8], // 0.0.0.0/8 — current network and unspecified addresses
  [0x0a000000, 8], // 10.0.0.0/8 — private-use networks
  [0x64400000, 10], // 100.64.0.0/10 — carrier-grade NAT shared space
  [0x7f000000, 8], // 127.0.0.0/8 — loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 — link-local and cloud metadata endpoints
  [0xac100000, 12], // 172.16.0.0/12 — private-use networks
  [0xc0000000, 24], // 192.0.0.0/24 — IETF protocol assignments
  [0xc0000200, 24], // 192.0.2.0/24 — TEST-NET-1 documentation
  [0xc01fc400, 24], // 192.31.196.0/24 — AS112-v4 special-purpose service
  [0xc034c100, 24], // 192.52.193.0/24 — Automatic Multicast Tunneling relay
  [0xc0586300, 24], // 192.88.99.0/24 — deprecated 6to4 relay anycast
  [0xc0a80000, 16], // 192.168.0.0/16 — private-use networks
  [0xc0af3000, 24], // 192.175.48.0/24 — direct-delegation AS112 service
  [0xc6120000, 15], // 198.18.0.0/15 — network benchmark testing
  [0xc6336400, 24], // 198.51.100.0/24 — TEST-NET-2 documentation
  [0xcb007100, 24], // 203.0.113.0/24 — TEST-NET-3 documentation
  [0xe0000000, 4], // 224.0.0.0/4 — multicast
  [0xf0000000, 4], // 240.0.0.0/4 — reserved, including limited broadcast
];

// IANA IPv6 Global Unicast Address Space, last reviewed 2026-08-20.
const PUBLIC_IPV6_RANGES: readonly Ipv6Range[] = [
  [[0x2001, 0x0200], 23], // 2001:200::/23 — APNIC
  [[0x2001, 0x0400], 23], // 2001:400::/23 — ARIN
  [[0x2001, 0x0600], 23], // 2001:600::/23 — RIPE NCC
  [[0x2001, 0x0800], 22], // 2001:800::/22 — RIPE NCC
  [[0x2001, 0x0c00], 23], // 2001:c00::/23 — APNIC
  [[0x2001, 0x0e00], 23], // 2001:e00::/23 — APNIC
  [[0x2001, 0x1200], 23], // 2001:1200::/23 — LACNIC
  [[0x2001, 0x1400], 22], // 2001:1400::/22 — RIPE NCC
  [[0x2001, 0x1800], 23], // 2001:1800::/23 — ARIN
  [[0x2001, 0x1a00], 23], // 2001:1a00::/23 — RIPE NCC
  [[0x2001, 0x1c00], 22], // 2001:1c00::/22 — RIPE NCC
  [[0x2001, 0x2000], 19], // 2001:2000::/19 — RIPE NCC
  [[0x2001, 0x4000], 23], // 2001:4000::/23 — RIPE NCC
  [[0x2001, 0x4200], 23], // 2001:4200::/23 — AFRINIC
  [[0x2001, 0x4400], 23], // 2001:4400::/23 — APNIC
  [[0x2001, 0x4600], 23], // 2001:4600::/23 — RIPE NCC
  [[0x2001, 0x4800], 23], // 2001:4800::/23 — ARIN
  [[0x2001, 0x4a00], 23], // 2001:4a00::/23 — RIPE NCC
  [[0x2001, 0x4c00], 23], // 2001:4c00::/23 — RIPE NCC
  [[0x2001, 0x5000], 20], // 2001:5000::/20 — RIPE NCC
  [[0x2001, 0x8000], 19], // 2001:8000::/19 — APNIC
  [[0x2001, 0xa000], 20], // 2001:a000::/20 — APNIC
  [[0x2001, 0xb000], 20], // 2001:b000::/20 — APNIC
  [[0x2003], 18], // 2003::/18 — RIPE NCC
  [[0x2400], 12], // 2400::/12 — APNIC
  [[0x2410], 12], // 2410::/12 — APNIC
  [[0x2600], 12], // 2600::/12 — ARIN
  [[0x2610], 23], // 2610::/23 — ARIN
  [[0x2620], 23], // 2620::/23 — ARIN
  [[0x2630], 12], // 2630::/12 — ARIN
  [[0x2800], 12], // 2800::/12 — LACNIC
  [[0x2a00], 12], // 2a00::/12 — RIPE NCC
  [[0x2a10], 12], // 2a10::/12 — RIPE NCC
  [[0x2c00], 12], // 2c00::/12 — AFRINIC
];

const BLOCKED_PUBLIC_IPV6_RANGES: readonly Ipv6Range[] = [
  [[0x2001, 0x0db8], 32], // 2001:db8::/32 — documentation
  [[0x2620, 0x004f, 0x8000], 48], // 2620:4f:8000::/48 — AS112 special-purpose service
];

function parseIpv4(address: string): number {
  const octets = address.split(".").map(Number);
  const first = octets[0] ?? 0;
  const second = octets[1] ?? 0;
  const third = octets[2] ?? 0;
  const fourth = octets[3] ?? 0;
  return ((first << 24) | (second << 16) | (third << 8) | fourth) >>> 0;
}

function ipv4Matches(value: number, network: number, prefixLength: number): boolean {
  return value >>> (32 - prefixLength) === network >>> (32 - prefixLength);
}

function parseIpv6Part(part: string): number[] {
  if (part.length === 0) {
    return [];
  }

  const groups: number[] = [];
  for (const token of part.split(":")) {
    if (token.includes(".")) {
      const ipv4 = parseIpv4(token);
      groups.push(ipv4 >>> 16, ipv4 & 0xffff);
    } else {
      groups.push(Number.parseInt(token, 16));
    }
  }
  return groups;
}

function parseIpv6(address: string): readonly number[] {
  const compressionIndex = address.indexOf("::");
  if (compressionIndex === -1) {
    return parseIpv6Part(address);
  }

  const left = parseIpv6Part(address.slice(0, compressionIndex));
  const right = parseIpv6Part(address.slice(compressionIndex + 2));
  const missingGroups = 8 - left.length - right.length;
  return [...left, ...new Array<number>(missingGroups).fill(0), ...right];
}

function ipv6Matches(
  value: readonly number[],
  network: readonly number[],
  prefixLength: number,
): boolean {
  const wholeGroups = Math.floor(prefixLength / 16);
  const remainingBits = prefixLength % 16;

  for (let index = 0; index < wholeGroups; index += 1) {
    if (value[index] !== (network[index] ?? 0)) {
      return false;
    }
  }

  if (remainingBits === 0) {
    return true;
  }

  const mask = (0xffff << (16 - remainingBits)) & 0xffff;
  return ((value[wholeGroups] ?? 0) & mask) === ((network[wholeGroups] ?? 0) & mask);
}

function formatIpv6(groups: readonly number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;

  for (let index = 0; index <= groups.length; index += 1) {
    if (index < groups.length && groups[index] === 0) {
      if (currentStart === -1) {
        currentStart = index;
      }
      continue;
    }

    if (currentStart !== -1) {
      const currentLength = index - currentStart;
      if (currentLength > bestLength) {
        bestStart = currentStart;
        bestLength = currentLength;
      }
      currentStart = -1;
    }
  }

  if (bestLength < 2) {
    return groups.map((group) => group.toString(16)).join(":");
  }

  const left = groups
    .slice(0, bestStart)
    .map((group) => group.toString(16))
    .join(":");
  const right = groups
    .slice(bestStart + bestLength)
    .map((group) => group.toString(16))
    .join(":");
  return `${left}::${right}`;
}

/** Returns a canonical IP literal, or `undefined` when the input is not a safe literal form. */
export function normalizeIpAddress(address: string): string | undefined {
  // Scoped IPv6 literals are interface-dependent and must never enter a portable pinned target.
  if (address.includes("%")) {
    return undefined;
  }
  if (isIPv4(address)) {
    return address.split(".").map(Number).join(".");
  }
  if (isIPv6(address)) {
    return formatIpv6(parseIpv6(address.toLowerCase()));
  }
  return undefined;
}

/**
 * Returns whether an address is eligible as an outbound QueryHost destination.
 *
 * IPv4 uses a denylist of special-purpose ranges. IPv6 uses an allocation allowlist so currently
 * reserved gaps inside global unicast fail closed, followed by explicit special-purpose exclusions.
 */
export function isPublicAddress(address: string): boolean {
  if (address.includes("%")) {
    return false;
  }
  const family = isIP(address);
  if (family === 4) {
    const value = parseIpv4(address);
    return !BLOCKED_IPV4_RANGES.some(([network, prefixLength]) =>
      ipv4Matches(value, network, prefixLength),
    );
  }
  if (family !== 6) {
    return false;
  }

  const value = parseIpv6(address.toLowerCase());

  // The global-unicast registry reserves unallocated space inside 2000::/3.
  // An allowlist ensures those gaps remain blocked until the policy is reviewed.
  if (
    !PUBLIC_IPV6_RANGES.some(([network, prefixLength]) => ipv6Matches(value, network, prefixLength))
  ) {
    return false;
  }

  return !BLOCKED_PUBLIC_IPV6_RANGES.some(([network, prefixLength]) =>
    ipv6Matches(value, network, prefixLength),
  );
}
