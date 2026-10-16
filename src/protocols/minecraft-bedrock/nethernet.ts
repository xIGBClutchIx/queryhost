/** NetherNet's fixed HTTP capability/status endpoint; no signalling or WebRTC session is opened. */

import type { PinnedAddress, PinnedTarget } from "../../network/target.js";
import type { ExecutionScope } from "../../runtime/execution.js";
import {
  fixedHttpExchange,
  HttpTransportError,
  type FixedHttpExchangeOptions,
  type FixedHttpExchangeResult,
} from "../../transports/http.js";
import { failMinecraftBedrock } from "./errors.js";

const MAX_RESPONSE_BYTES = 16_384;
const MAX_STRING_LENGTH = 1_024;
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Optional metadata advertised by `GET /v1/join`. Empty responses confirm capability only. */
export interface NetherNetStatus {
  readonly name?: string;
  readonly protocol?: number;
  readonly version?: string;
  readonly level?: string;
  readonly players?: number;
  readonly maxPlayers?: number;
  readonly gameType?: number;
}

/** One bounded HTTP exchange, injectable without replacing target validation. */
export interface NetherNetDependencies {
  readonly exchange: (options: FixedHttpExchangeOptions) => Promise<FixedHttpExchangeResult>;
}

/** Parses documented metadata without inventing facts for capability-only servers. */
export function parseNetherNetStatus(data: Uint8Array): NetherNetStatus {
  if (data.byteLength > MAX_RESPONSE_BYTES) return failMinecraftBedrock("RESPONSE_TOO_LARGE");
  if (data.byteLength === 0) return Object.freeze({});
  let value: JsonValue;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)) as JsonValue;
  } catch {
    return failMinecraftBedrock("MALFORMED_RESPONSE");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return failMinecraftBedrock("MALFORMED_RESPONSE");
  }
  const fields = value;
  const text = (key: string): string | undefined => {
    const field = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (field === undefined) return undefined;
    return typeof field === "string" && field.length <= MAX_STRING_LENGTH
      ? field
      : failMinecraftBedrock("MALFORMED_RESPONSE");
  };
  const count = (key: string): number | undefined => {
    const field = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (field === undefined) return undefined;
    return typeof field === "number" && Number.isSafeInteger(field) && field >= 0
      ? field
      : failMinecraftBedrock("MALFORMED_RESPONSE");
  };
  const name = text("name");
  const protocol = count("protocol");
  const version = text("version");
  const level = text("level");
  const players = count("players");
  const maxPlayers = count("maxPlayers");
  const gameType = count("gameType");
  if (
    Object.keys(fields).length > 0 &&
    [name, protocol, version, level, players, maxPlayers, gameType].every(
      (field) => field === undefined,
    )
  ) {
    return failMinecraftBedrock("MALFORMED_RESPONSE");
  }
  return Object.freeze({
    ...(name === undefined ? {} : { name }),
    ...(protocol === undefined ? {} : { protocol }),
    ...(version === undefined ? {} : { version }),
    ...(level === undefined ? {} : { level }),
    ...(players === undefined ? {} : { players }),
    ...(maxPlayers === undefined ? {} : { maxPlayers }),
    ...(gameType === undefined ? {} : { gameType }),
  });
}

/** Reads metadata from one pinned address. HTTP redirects and advertised destinations are not followed. */
export async function queryNetherNetStatus(
  options: {
    readonly scope: ExecutionScope;
    readonly target: PinnedTarget;
    readonly address: PinnedAddress;
  },
  dependencies: NetherNetDependencies = { exchange: fixedHttpExchange },
): Promise<{ readonly status: NetherNetStatus; readonly rttMs: number }> {
  const response = await dependencies.exchange({
    ...options,
    protocol: "http",
    path: "/v1/join",
    maxResponseBytes: MAX_RESPONSE_BYTES,
  });
  if (response.statusCode < 200 || response.statusCode > 299) {
    throw new HttpTransportError("CONNECTION_FAILED");
  }
  return Object.freeze({ status: parseNetherNetStatus(response.data), rttMs: response.rttMs });
}
