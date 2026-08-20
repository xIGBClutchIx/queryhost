/**
 * Safe target resolution for untrusted host and port input.
 *
 * Resolution happens once, every answer is validated, and transports receive immutable pinned
 * addresses so a later DNS response cannot redirect the connection.
 */

import { resolve4, resolve6, resolveSrv } from "node:dns/promises";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";

import { isPublicAddress, normalizeIpAddress } from "./ip.js";
import type { QueryErrorCode } from "./shared.js";

const MAX_ADDRESS_RECORDS = 16; // Bounds validation work and the transport's fallback set.
const MAX_SRV_RECORDS = 16; // Bounds derived lookups before an SRV target is contacted.

/** Target-validation failures that map directly to stable public query error codes. */
export type TargetResolutionErrorCode = Extract<
  QueryErrorCode,
  "DNS_FAILED" | "INVALID_INPUT" | "TARGET_BLOCKED"
>;

const ERROR_MESSAGES: Readonly<Record<TargetResolutionErrorCode, string>> = {
  DNS_FAILED: "The target could not be resolved.",
  INVALID_INPUT: "The target host or port is invalid.",
  TARGET_BLOCKED: "The target is not publicly routable.",
} as const;

/** Address family values accepted by Node socket APIs. */
export type IpFamily = 4 | 6;
/** Transport labels permitted in an SRV owner name. */
export type SrvProtocol = "tcp" | "udp";

/** One A or AAAA answer returned by a resolver adapter. */
export interface DnsAddressRecord {
  readonly address: string;
  readonly family: IpFamily;
}

/** Minimal SRV record shape needed before profile-specific selection. */
export interface DnsSrvRecord {
  readonly name: string;
  readonly port: number;
  readonly priority: number;
  readonly weight: number;
}

/** Injectable resolver boundary used by production DNS and deterministic tests. */
export interface DnsResolver {
  readonly resolveAddresses: (hostname: string) => Promise<readonly DnsAddressRecord[]>;
  readonly resolveSrv: (name: string) => Promise<readonly DnsSrvRecord[]>;
}

/** Node DNS functions required to construct the default resolver adapter. */
export interface DnsFunctions {
  readonly resolve4: (hostname: string) => Promise<readonly string[]>;
  readonly resolve6: (hostname: string) => Promise<readonly string[]>;
  readonly resolveSrv: (name: string) => Promise<readonly DnsSrvRecord[]>;
}

/** Untrusted primary target before normalization and resolution. */
export interface TargetInput {
  readonly host: string;
  readonly port: number;
}

/** Canonical address approved for a later transport connection. */
export interface PinnedAddress {
  readonly address: string;
  readonly family: IpFamily;
}

/**
 * Normalized target and the complete immutable address set approved during one resolution pass.
 * `hostname` is retained only for protocol metadata such as HTTP Host or TLS SNI.
 */
export interface PinnedTarget {
  readonly hostname: string;
  readonly port: number;
  readonly addresses: readonly PinnedAddress[];
}

/** Inputs used to form a fixed SRV owner name. */
export interface SrvInput {
  readonly service: string;
  readonly protocol: SrvProtocol;
  readonly host: string;
}

/** Validated SRV metadata paired with a fully pinned derived target. */
export interface ResolvedSrvTarget {
  readonly priority: number;
  readonly weight: number;
  readonly target: PinnedTarget;
}

/** Error with a stable code and message safe to map into a public query failure. */
export class TargetResolutionError extends Error {
  public override readonly name = "TargetResolutionError";
  public readonly code: TargetResolutionErrorCode;

  public constructor(code: TargetResolutionErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.code = code;
  }
}

async function resolveIpv4(
  hostname: string,
  dns: DnsFunctions,
): Promise<readonly DnsAddressRecord[]> {
  try {
    return (await dns.resolve4(hostname)).map((address) => ({ address, family: 4 }));
  } catch {
    return [];
  }
}

async function resolveIpv6(
  hostname: string,
  dns: DnsFunctions,
): Promise<readonly DnsAddressRecord[]> {
  try {
    return (await dns.resolve6(hostname)).map((address) => ({ address, family: 6 }));
  } catch {
    return [];
  }
}

/**
 * Adapts Node-style A, AAAA, and SRV functions to the QueryHost resolver boundary.
 * A missing address family does not discard successful answers from the other family.
 */
export function createDnsResolver(dns: DnsFunctions): DnsResolver {
  return {
    async resolveAddresses(hostname: string): Promise<readonly DnsAddressRecord[]> {
      const [ipv4, ipv6] = await Promise.all([
        resolveIpv4(hostname, dns),
        resolveIpv6(hostname, dns),
      ]);
      return [...ipv4, ...ipv6];
    },
    async resolveSrv(name: string): Promise<readonly DnsSrvRecord[]> {
      try {
        return await dns.resolveSrv(name);
      } catch {
        return [];
      }
    },
  };
}

const NODE_DNS_RESOLVER = createDnsResolver({ resolve4, resolve6, resolveSrv });

function fail(code: TargetResolutionErrorCode): never {
  throw new TargetResolutionError(code);
}

function isValidDnsLabel(label: string): boolean {
  return (
    label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)
  );
}

function freezeAddress(address: string, family: IpFamily): PinnedAddress {
  return Object.freeze({ address, family });
}

function freezeTarget(
  hostname: string,
  port: number,
  addresses: readonly PinnedAddress[],
): PinnedTarget {
  return Object.freeze({ hostname, port, addresses: Object.freeze([...addresses]) });
}

function validateUnsignedShort(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
    fail("DNS_FAILED");
  }
  return value;
}

function normalizeSrvHostname(hostname: string): string {
  try {
    return normalizeHostname(hostname);
  } catch {
    return fail("DNS_FAILED");
  }
}

function validateSrvPort(port: number): number {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    return fail("DNS_FAILED");
  }
  return port;
}

async function resolvePinnedAddresses(
  hostname: string,
  resolver: DnsResolver,
): Promise<readonly PinnedAddress[]> {
  const literal = normalizeIpAddress(hostname);
  if (literal !== undefined) {
    if (!isPublicAddress(literal)) {
      fail("TARGET_BLOCKED");
    }
    const family = isIP(literal);
    if (family !== 4 && family !== 6) {
      return fail("DNS_FAILED");
    }
    return Object.freeze([freezeAddress(literal, family)]);
  }

  let records: readonly DnsAddressRecord[];
  try {
    records = await resolver.resolveAddresses(hostname);
  } catch {
    return fail("DNS_FAILED");
  }

  if (records.length === 0) {
    fail("DNS_FAILED");
  }
  if (records.length > MAX_ADDRESS_RECORDS) {
    fail("TARGET_BLOCKED");
  }

  // One unsafe answer rejects the entire set. Selecting only a convenient public answer would
  // permit mixed public/private DNS responses to become a rebinding primitive.
  const addresses = new Map<string, PinnedAddress>();
  for (const record of records) {
    const address = normalizeIpAddress(record.address);
    if (address === undefined || isIP(address) !== record.family) {
      fail("DNS_FAILED");
    }
    if (!isPublicAddress(address)) {
      fail("TARGET_BLOCKED");
    }
    const familyKey = record.family === 4 ? "4" : "6";
    addresses.set(`${familyKey}:${address}`, freezeAddress(address, record.family));
  }

  return Object.freeze([...addresses.values()]);
}

/**
 * Normalizes a DNS hostname, IDN, or IP literal.
 *
 * URL syntax, whitespace, ambiguous numeric hosts, zone identifiers, and malformed labels fail
 * with `INVALID_INPUT`. A terminal DNS root dot is accepted and removed.
 */
export function normalizeHostname(host: string): string {
  if (host.length === 0 || host !== host.trim()) {
    return fail("INVALID_INPUT");
  }

  let candidate = host;
  if (candidate.startsWith("[") || candidate.endsWith("]")) {
    if (!(candidate.startsWith("[") && candidate.endsWith("]"))) {
      return fail("INVALID_INPUT");
    }
    candidate = candidate.slice(1, -1);
  }

  const literal = normalizeIpAddress(candidate);
  if (literal !== undefined) {
    return literal;
  }
  if (candidate.includes(":") || /^\d+$/u.test(candidate)) {
    return fail("INVALID_INPUT");
  }

  let ascii: string;
  try {
    ascii = domainToASCII(candidate).toLowerCase();
  } catch {
    return fail("INVALID_INPUT");
  }
  if (ascii.endsWith(".")) {
    ascii = ascii.slice(0, -1);
  }

  if (ascii.length === 0 || ascii.length > 253 || !ascii.split(".").every(isValidDnsLabel)) {
    return fail("INVALID_INPUT");
  }
  return ascii;
}

/** Validates an explicit TCP or UDP port in the inclusive range 1–65535. */
export function validatePort(port: number): number {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    return fail("INVALID_INPUT");
  }
  return port;
}

/** Resolves, validates, deduplicates, freezes, and returns one primary target. */
export async function resolveTarget(
  input: TargetInput,
  resolver: DnsResolver = NODE_DNS_RESOLVER,
): Promise<PinnedTarget> {
  const hostname = normalizeHostname(input.host);
  const port = validatePort(input.port);
  const addresses = await resolvePinnedAddresses(hostname, resolver);
  return freezeTarget(hostname, port, addresses);
}

/**
 * Resolves a fixed SRV owner name and reapplies target safety to every derived host and port.
 *
 * This function preserves DNS priority and weight metadata but intentionally defers profile-specific
 * ordering and weighted selection to the protocol slice that consumes it.
 */
export async function resolveSrvTargets(
  input: SrvInput,
  resolver: DnsResolver = NODE_DNS_RESOLVER,
): Promise<readonly ResolvedSrvTarget[]> {
  const hostname = normalizeHostname(input.host);
  const service = input.service.toLowerCase();
  if (!isValidDnsLabel(service)) {
    return fail("INVALID_INPUT");
  }

  let records: readonly DnsSrvRecord[];
  try {
    records = await resolver.resolveSrv(`_${service}._${input.protocol}.${hostname}`);
  } catch {
    return fail("DNS_FAILED");
  }

  if (records.length > MAX_SRV_RECORDS) {
    return fail("TARGET_BLOCKED");
  }
  if (records.length === 1 && records[0]?.name === ".") {
    return Object.freeze([]);
  }
  if (records.length === 0 || records.some((record) => record.name === ".")) {
    return fail("DNS_FAILED");
  }

  const normalizedRecords = records.map((record) => ({
    hostname: normalizeSrvHostname(record.name),
    port: validateSrvPort(record.port),
    priority: validateUnsignedShort(record.priority),
    weight: validateUnsignedShort(record.weight),
  }));
  // Duplicate SRV records may use different ports on the same host. Cache by normalized hostname so
  // all of them share the exact same validated DNS snapshot.
  const addressLookups = new Map<string, Promise<readonly PinnedAddress[]>>();
  for (const record of normalizedRecords) {
    if (!addressLookups.has(record.hostname)) {
      addressLookups.set(record.hostname, resolvePinnedAddresses(record.hostname, resolver));
    }
  }

  const resolved = await Promise.all(
    normalizedRecords.map(async (record): Promise<ResolvedSrvTarget> => {
      const addresses = await addressLookups.get(record.hostname);
      if (addresses === undefined) {
        return fail("DNS_FAILED");
      }
      return Object.freeze({
        priority: record.priority,
        weight: record.weight,
        target: freezeTarget(record.hostname, record.port, addresses),
      });
    }),
  );
  return Object.freeze(resolved);
}
