/**
 * Project Reclaimer's server-browser status exchange: one length-framed JSON request and answer on
 * a QUIC stream to the server's UDP game port.
 */

import type { PinnedAddress, PinnedTarget } from "../../network/target.js";
import type { ExecutionScope } from "../../runtime/execution.js";
import {
  quicExchange,
  type QuicExchangeOptions,
  type QuicExchangeResult,
  type QuicResponseState,
  type QuicTransportDependencies,
} from "../../transports/quic.js";
import { failProjectReclaimer } from "./errors.js";

const FRAME_HEADER_BYTES = 4;
/**
 * Every server presents a self-signed certificate for this fixed name, whatever its address, and
 * the game's own browser sends it as SNI.
 */
const SERVER_NAME = "reclaimer";
/** Status schema version the 0.9.23 browser requests; older values return fewer mod fields. */
const STATUS_VERSION = 2;
/** Upper bound for one framed answer; observed answers with many mods stay under 5 KB. */
export const PROJECT_RECLAIMER_MAX_RESPONSE_BYTES = 65_536;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_NODES = 16_384;
const MAX_STRING_LENGTH = 1_024;
const MAX_PLAYER_NAMES = 512;
const MAX_MODS = 256;
const MAX_MOD_MAPS = 256;

type JsonValue = boolean | null | number | string | JsonValue[] | JsonObject;
interface JsonObject {
  [key: string]: JsonValue;
}

/** One map file a listed mod provides. */
export interface ProjectReclaimerStatusModMap {
  readonly stem: string;
  readonly digest: string;
}

/** One mod entry; only `id` is required to identify it. */
export interface ProjectReclaimerStatusMod {
  readonly id: string;
  readonly title?: string;
  readonly maps?: readonly ProjectReclaimerStatusModMap[];
  readonly sizeBytes?: number;
  readonly shared?: boolean;
  readonly required?: boolean;
  readonly customization?: boolean;
}

/** Halo 3: ODST settings, present only on servers running ODST content. */
export interface ProjectReclaimerStatusOdst {
  readonly mode?: string;
  readonly mission?: number;
  readonly insertion?: number;
  readonly difficulty?: string;
  readonly variant?: string;
}

/**
 * Facts read from the status JSON. Every field is optional: servers omit fields that do not apply,
 * and an absent or `null` key is omitted, never replaced with a zero, `false`, or empty value.
 */
export interface ProjectReclaimerStatus {
  readonly name?: string;
  readonly hostName?: string;
  readonly map?: string;
  readonly mode?: string;
  readonly variant?: string;
  readonly mapVariant?: string;
  readonly players?: number;
  readonly capacity?: number;
  readonly ready?: boolean;
  readonly passwordRequired?: boolean;
  readonly version?: string;
  readonly blocksVpn?: boolean;
  readonly maxPingMs?: number;
  readonly playerNames?: readonly string[];
  readonly mods?: readonly ProjectReclaimerStatusMod[];
  readonly odst?: ProjectReclaimerStatusOdst;
}

/** Parsed status and the exchange's complete duration, QUIC handshake included. */
export interface ProjectReclaimerStatusResult {
  readonly status: ProjectReclaimerStatus;
  readonly rttMs: number;
}

/** Inputs for one request against an address from an already validated target. */
export interface ProjectReclaimerStatusOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly address: PinnedAddress;
}

/** Injectable QUIC boundary used by deterministic profile tests. */
export interface ProjectReclaimerQueryDependencies {
  readonly quic?: QuicTransportDependencies;
  readonly exchange?: (
    options: QuicExchangeOptions,
    dependencies?: QuicTransportDependencies,
  ) => Promise<QuicExchangeResult>;
}

function frame(body: Uint8Array): Uint8Array {
  const framed = new Uint8Array(FRAME_HEADER_BYTES + body.byteLength);
  new DataView(framed.buffer).setUint32(0, body.byteLength);
  framed.set(body, FRAME_HEADER_BYTES);
  return framed;
}

/** The fixed request: a four-byte big-endian length, then `{"status":2}`. */
export function encodeProjectReclaimerStatusRequest(): Uint8Array {
  return frame(new TextEncoder().encode(JSON.stringify({ status: STATUS_VERSION })));
}

/** Reports whether the stream bytes so far hold exactly one complete, bounded frame. */
export function inspectProjectReclaimerStatusResponse(data: Uint8Array): QuicResponseState {
  if (data.byteLength < FRAME_HEADER_BYTES) {
    return "incomplete";
  }
  const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0);
  if (length === 0) {
    return "malformed";
  }
  if (FRAME_HEADER_BYTES + length > PROJECT_RECLAIMER_MAX_RESPONSE_BYTES) {
    return "too-large";
  }
  const available = data.byteLength - FRAME_HEADER_BYTES;
  return available < length ? "incomplete" : available === length ? "complete" : "malformed";
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateJsonBudget(value: JsonValue): void {
  let nodes = 0;
  const visit = (current: JsonValue, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      failProjectReclaimer("MALFORMED_RESPONSE");
    }
    if (Array.isArray(current)) {
      for (const entry of current) {
        visit(entry, depth + 1);
      }
    } else if (isObject(current)) {
      for (const entry of Object.values(current)) {
        visit(entry, depth + 1);
      }
    }
  };
  visit(value, 0);
}

function parseJson(data: Uint8Array): JsonObject {
  let value: JsonValue;
  try {
    // JSON.parse can only produce this recursive value domain; field validation follows.
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)) as JsonValue;
  } catch {
    return failProjectReclaimer("MALFORMED_RESPONSE");
  }
  validateJsonBudget(value);
  return isObject(value) ? value : failProjectReclaimer("MALFORMED_RESPONSE");
}

function present(object: JsonObject, key: string): JsonValue | undefined {
  const value = Object.hasOwn(object, key) ? object[key] : undefined;
  return value === null ? undefined : value;
}

function text(object: JsonObject, key: string): string | undefined {
  const value = present(object, key);
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" && value.length <= MAX_STRING_LENGTH
    ? value
    : failProjectReclaimer("MALFORMED_RESPONSE");
}

function flag(object: JsonObject, key: string): boolean | undefined {
  const value = present(object, key);
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "boolean" ? value : failProjectReclaimer("MALFORMED_RESPONSE");
}

function count(object: JsonObject, key: string): number | undefined {
  const value = present(object, key);
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : failProjectReclaimer("MALFORMED_RESPONSE");
}

function list(object: JsonObject, key: string, limit: number): readonly JsonValue[] | undefined {
  const value = present(object, key);
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) && value.length <= limit
    ? value
    : failProjectReclaimer("MALFORMED_RESPONSE");
}

function nested(object: JsonObject, key: string): JsonObject | undefined {
  const value = present(object, key);
  if (value === undefined) {
    return undefined;
  }
  return isObject(value) ? value : failProjectReclaimer("MALFORMED_RESPONSE");
}

function playerNames(object: JsonObject): readonly string[] | undefined {
  const entries = list(object, "player_names", MAX_PLAYER_NAMES);
  if (entries === undefined) {
    return undefined;
  }
  return Object.freeze(
    entries.map((entry) =>
      typeof entry === "string" && entry.length <= MAX_STRING_LENGTH
        ? entry
        : failProjectReclaimer("MALFORMED_RESPONSE"),
    ),
  );
}

/** Drops `undefined` entries, turning each `T | undefined` field back into an omitted one. */
function withoutOmitted<T extends object>(fields: {
  readonly [K in keyof T]-?: T[K] | undefined;
}): T {
  // Only the declared keys exist and each kept value has its declared type.
  return Object.freeze(
    Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
  ) as T;
}

function modMap(entry: JsonValue): ProjectReclaimerStatusModMap {
  if (!isObject(entry)) {
    return failProjectReclaimer("MALFORMED_RESPONSE");
  }
  const stem = text(entry, "stem");
  const digest = text(entry, "digest");
  if (stem === undefined || digest === undefined) {
    return failProjectReclaimer("MALFORMED_RESPONSE");
  }
  return Object.freeze({ stem, digest });
}

function mod(entry: JsonValue): ProjectReclaimerStatusMod {
  if (!isObject(entry)) {
    return failProjectReclaimer("MALFORMED_RESPONSE");
  }
  const id = text(entry, "id") ?? failProjectReclaimer("MALFORMED_RESPONSE");
  const maps = list(entry, "maps", MAX_MOD_MAPS);
  return withoutOmitted<ProjectReclaimerStatusMod>({
    id,
    title: text(entry, "title"),
    maps: maps === undefined ? undefined : Object.freeze(maps.map(modMap)),
    sizeBytes: count(entry, "size"),
    shared: flag(entry, "shared"),
    required: flag(entry, "required"),
    customization: flag(entry, "customization"),
  });
}

function odst(object: JsonObject): ProjectReclaimerStatusOdst | undefined {
  const settings = nested(object, "odst");
  if (settings === undefined) {
    return undefined;
  }
  return withoutOmitted<ProjectReclaimerStatusOdst>({
    mode: text(settings, "mode"),
    mission: count(settings, "mission"),
    insertion: count(settings, "insertion"),
    difficulty: text(settings, "difficulty"),
    variant: text(settings, "variant"),
  });
}

/** Parses one complete framed answer without retaining unknown fields. */
export function parseProjectReclaimerStatusResponse(data: Uint8Array): ProjectReclaimerStatus {
  const framing = inspectProjectReclaimerStatusResponse(data);
  if (framing !== "complete") {
    return failProjectReclaimer(
      framing === "too-large" ? "RESPONSE_TOO_LARGE" : "MALFORMED_RESPONSE",
    );
  }
  const root = parseJson(data.subarray(FRAME_HEADER_BYTES));
  const mods = list(root, "mods", MAX_MODS);
  return withoutOmitted<ProjectReclaimerStatus>({
    name: text(root, "name"),
    hostName: text(root, "host_name"),
    map: text(root, "map"),
    mode: text(root, "mode"),
    variant: text(root, "variant"),
    mapVariant: text(root, "map_variant"),
    players: count(root, "players"),
    capacity: count(root, "capacity"),
    ready: flag(root, "ready"),
    passwordRequired: flag(root, "password_required"),
    version: text(root, "version"),
    blocksVpn: flag(root, "blocks_vpn"),
    maxPingMs: count(root, "max_ping"),
    playerNames: playerNames(root),
    mods: mods === undefined ? undefined : Object.freeze(mods.map(mod)),
    odst: odst(root),
  });
}

/** Requests and parses the status of one pinned address over QUIC. */
export async function queryProjectReclaimerStatus(
  options: ProjectReclaimerStatusOptions,
  dependencies: ProjectReclaimerQueryDependencies = {},
): Promise<ProjectReclaimerStatusResult> {
  const response = await (dependencies.exchange ?? quicExchange)(
    {
      scope: options.scope,
      target: options.target,
      address: options.address,
      serverName: SERVER_NAME,
      // Servers present a fresh self-signed certificate; nothing exists to validate it against.
      tlsCertificatePolicy: "disabled",
      request: encodeProjectReclaimerStatusRequest(),
      maxResponseBytes: PROJECT_RECLAIMER_MAX_RESPONSE_BYTES,
      inspectResponse: inspectProjectReclaimerStatusResponse,
    },
    dependencies.quic,
  );
  return Object.freeze({
    status: parseProjectReclaimerStatusResponse(response.data),
    rttMs: response.rttMs,
  });
}
