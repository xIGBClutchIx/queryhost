/** Strict parsers and fixed-path requests for FiveM's public JSON endpoints. */

import type { ExecutionScope } from "../../execution.js";
import type { FiveMPlayer } from "../../games.js";
import type { QueryError, QuerySourceName, QuerySourceStatus } from "../../shared.js";
import type { PinnedAddress, PinnedTarget } from "../../target.js";
import {
  fixedHttpExchange,
  HttpTransportError,
  type FixedHttpExchangeOptions,
  type FixedHttpExchangeResult,
  type HttpTransportDependencies,
} from "../../transports/http.js";

const INFO_PATH = "/info.json";
const DYNAMIC_PATH = "/dynamic.json";
const PLAYERS_PATH = "/players.json";
const INFO_MAX_BYTES = 1_048_576;
const DYNAMIC_MAX_BYTES = 65_536;
const PLAYERS_MAX_BYTES = 1_048_576;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 65_536;
const MAX_COLLECTION_ITEMS = 4_096;
const MAX_SHORT_STRING_LENGTH = 8_192;
const MAX_JSON_STRING_LENGTH = INFO_MAX_BYTES;

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonArray | JsonObject;
type JsonArray = JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}

/** Parsed facts from FiveM's `info.json`. */
export interface FiveMInfo {
  readonly server?: string;
  readonly resources?: readonly string[];
  readonly variables?: Readonly<Record<string, string>>;
  readonly oneSyncEnabled?: boolean;
  readonly enhancedHostSupport?: boolean;
}

/** Parsed facts from FiveM's `dynamic.json`. */
export interface FiveMDynamic {
  readonly hostname?: string;
  readonly mapName?: string;
  readonly gameType?: string;
  readonly clients?: number;
  readonly maxClients?: number;
}

/** One successful fixed endpoint response. */
export interface FiveMEndpointResult<T> {
  readonly value: T;
  readonly rttMs: number;
}

/** A source-owned endpoint failure with stable provenance and public-safe error details. */
export class FiveMEndpointError extends Error {
  public override readonly name = "FiveMEndpointError";
  public readonly source: QuerySourceName;
  public readonly status: QuerySourceStatus;
  public readonly queryError: QueryError;

  public constructor(source: QuerySourceName, status: QuerySourceStatus, queryError: QueryError) {
    super(queryError.message);
    this.source = source;
    this.status = status;
    this.queryError = queryError;
  }
}

/** Injectable HTTP boundary used by all three FiveM sources. */
export interface FiveMQueryDependencies {
  readonly http?: HttpTransportDependencies;
  readonly exchange?: (
    options: FixedHttpExchangeOptions,
    dependencies?: HttpTransportDependencies,
  ) => Promise<FixedHttpExchangeResult>;
}

interface EndpointOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly address: PinnedAddress;
}

function malformed(source: QuerySourceName): never {
  throw new FiveMEndpointError(source, "malformed", {
    code: "MALFORMED_RESPONSE",
    message: "The FiveM endpoint returned malformed JSON data.",
    source,
  });
}

function isObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateJsonBudget(value: JsonValue): void {
  let nodes = 0;
  const visit = (current: JsonValue, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      throw new RangeError("JSON budget exceeded.");
    }
    if (Array.isArray(current)) {
      if (current.length > MAX_COLLECTION_ITEMS) {
        throw new RangeError("JSON collection budget exceeded.");
      }
      for (const entry of current) {
        visit(entry, depth + 1);
      }
    } else if (isObject(current)) {
      const entries = Object.entries(current);
      if (entries.length > MAX_COLLECTION_ITEMS) {
        throw new RangeError("JSON collection budget exceeded.");
      }
      for (const [key, entry] of entries) {
        if (key.length > MAX_SHORT_STRING_LENGTH) {
          throw new RangeError("JSON string budget exceeded.");
        }
        visit(entry, depth + 1);
      }
    } else if (typeof current === "string" && current.length > MAX_JSON_STRING_LENGTH) {
      throw new RangeError("JSON string budget exceeded.");
    }
  };
  visit(value, 0);
}

function parseJson(data: Uint8Array, source: QuerySourceName): JsonValue {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return malformed(source);
  }
  const blockedBody = text.trim();
  if (blockedBody === "Nope" || blockedBody === "Nope.") {
    throw new FiveMEndpointError(source, "blocked", {
      code: "CONNECTION_FAILED",
      message: "The FiveM endpoint blocked this request.",
      source,
    });
  }
  try {
    const value = JSON.parse(text) as JsonValue;
    validateJsonBudget(value);
    return value;
  } catch {
    return malformed(source);
  }
}

function optionalString(
  object: JsonObject,
  key: string,
  source: QuerySourceName,
): string | undefined {
  const value = object[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length > MAX_SHORT_STRING_LENGTH) {
    return malformed(source);
  }
  return value;
}

function optionalBoolean(
  object: JsonObject,
  key: string,
  source: QuerySourceName,
): boolean | undefined {
  const value = object[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    return malformed(source);
  }
  return value;
}

function nonNegativeInteger(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function requiredNonNegativeInteger(
  object: JsonObject,
  key: string,
  source: QuerySourceName,
): number {
  const value = nonNegativeInteger(object[key]);
  return value ?? malformed(source);
}

function parseStringArray(
  value: JsonValue | undefined,
  source: QuerySourceName,
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_ITEMS) {
    return malformed(source);
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length > MAX_SHORT_STRING_LENGTH) {
      return malformed(source);
    }
    result.push(entry);
  }
  return Object.freeze(result);
}

function parseVariables(
  value: JsonValue | undefined,
  source: QuerySourceName,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value)) {
    return malformed(source);
  }
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" || entry.length > MAX_SHORT_STRING_LENGTH) {
      return malformed(source);
    }
    result[key] = entry;
  }
  return Object.freeze(result);
}

function parseBooleanString(value: string | undefined): boolean | undefined {
  if (value === "true" || value === "1" || value === "on") {
    return true;
  }
  if (value === "false" || value === "0" || value === "off") {
    return false;
  }
  return undefined;
}

/** Parses one bounded `info.json` body without retaining unknown fields. */
export function parseFiveMInfo(data: Uint8Array): FiveMInfo {
  const source = "fivem-info";
  const value = parseJson(data, source);
  if (!isObject(value)) {
    return malformed(source);
  }
  const variables = parseVariables(value["vars"], source);
  const server = optionalString(value, "server", source);
  const resources = parseStringArray(value["resources"], source);
  const oneSyncEnabled =
    variables === undefined ? undefined : parseBooleanString(variables["onesync_enabled"]);
  const enhancedHostSupport = optionalBoolean(value, "enhancedHostSupport", source);
  return Object.freeze({
    ...(server === undefined ? {} : { server }),
    ...(resources === undefined ? {} : { resources }),
    ...(variables === undefined ? {} : { variables }),
    ...(oneSyncEnabled === undefined ? {} : { oneSyncEnabled }),
    ...(enhancedHostSupport === undefined ? {} : { enhancedHostSupport }),
  });
}

function optionalInteger(
  object: JsonObject,
  key: string,
  source: QuerySourceName,
): number | undefined {
  const raw = object[key];
  if (raw === undefined) {
    return undefined;
  }
  const numeric =
    typeof raw === "string" && /^\d+$/u.test(raw) ? Number(raw) : nonNegativeInteger(raw);
  if (numeric === undefined || !Number.isSafeInteger(numeric) || numeric < 0) {
    return malformed(source);
  }
  return numeric;
}

/** Parses one bounded `dynamic.json` body without retaining unknown fields. */
export function parseFiveMDynamic(data: Uint8Array): FiveMDynamic {
  const source = "fivem-dynamic";
  const value = parseJson(data, source);
  if (!isObject(value)) {
    return malformed(source);
  }
  const hostname = optionalString(value, "hostname", source);
  const mapName = optionalString(value, "mapname", source);
  const gameType = optionalString(value, "gametype", source);
  const clients = optionalInteger(value, "clients", source);
  const maxClients = optionalInteger(value, "sv_maxclients", source);
  return Object.freeze({
    ...(hostname === undefined ? {} : { hostname }),
    ...(mapName === undefined ? {} : { mapName }),
    ...(gameType === undefined ? {} : { gameType }),
    ...(clients === undefined ? {} : { clients }),
    ...(maxClients === undefined ? {} : { maxClients }),
  });
}

/** Parses one bounded `players.json` body into the stable public player contract. */
export function parseFiveMPlayers(data: Uint8Array): readonly FiveMPlayer[] {
  const source = "fivem-players";
  const value = parseJson(data, source);
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_ITEMS) {
    return malformed(source);
  }
  const result: FiveMPlayer[] = [];
  for (const entry of value) {
    if (!isObject(entry)) {
      return malformed(source);
    }
    const name = optionalString(entry, "name", source);
    if (name === undefined) {
      return malformed(source);
    }
    const id = requiredNonNegativeInteger(entry, "id", source);
    const pingRaw = entry["ping"];
    const ping = pingRaw === undefined ? undefined : nonNegativeInteger(pingRaw);
    if (pingRaw !== undefined && ping === undefined) {
      return malformed(source);
    }
    result.push(Object.freeze({ id, name, ...(ping === undefined ? {} : { ping }) }));
  }
  return Object.freeze(result);
}

function endpointFailure(source: QuerySourceName, statusCode: number, data: Uint8Array): never {
  const trimmed = new TextDecoder().decode(data).trim();
  if (trimmed === "Nope" || trimmed === "Nope.") {
    throw new FiveMEndpointError(source, "blocked", {
      code: "CONNECTION_FAILED",
      message: "The FiveM endpoint blocked this request.",
      source,
    });
  }
  if (statusCode === 404) {
    throw new FiveMEndpointError(source, "unsupported", {
      code: "CONNECTION_FAILED",
      message: "The FiveM endpoint was not found.",
      source,
    });
  }
  throw new FiveMEndpointError(source, "failed", {
    code: "CONNECTION_FAILED",
    message: "The FiveM endpoint request failed.",
    source,
  });
}

async function queryEndpoint<T>(
  options: EndpointOptions,
  source: QuerySourceName,
  path: string,
  maxResponseBytes: number,
  parse: (data: Uint8Array) => T,
  dependencies: FiveMQueryDependencies,
): Promise<FiveMEndpointResult<T>> {
  try {
    const response = await (dependencies.exchange ?? fixedHttpExchange)(
      {
        scope: options.scope,
        target: options.target,
        address: options.address,
        protocol: "http",
        path,
        maxResponseBytes,
      },
      dependencies.http,
    );
    if (response.statusCode < 200 || response.statusCode > 299) {
      return endpointFailure(source, response.statusCode, response.data);
    }
    return Object.freeze({ value: parse(response.data), rttMs: response.rttMs });
  } catch (error) {
    if (error instanceof FiveMEndpointError) {
      throw error;
    }
    if (error instanceof HttpTransportError) {
      const status: QuerySourceStatus =
        error.code === "TIMEOUT"
          ? "timeout"
          : error.code === "MALFORMED_RESPONSE" || error.code === "RESPONSE_TOO_LARGE"
            ? "malformed"
            : "failed";
      throw new FiveMEndpointError(source, status, {
        code: error.code,
        message: error.message,
        source,
      });
    }
    throw error;
  }
}

/** Requests and parses FiveM's fixed `info.json` endpoint. */
export function queryFiveMInfo(
  options: EndpointOptions,
  dependencies: FiveMQueryDependencies = {},
): Promise<FiveMEndpointResult<FiveMInfo>> {
  return queryEndpoint(
    options,
    "fivem-info",
    INFO_PATH,
    INFO_MAX_BYTES,
    parseFiveMInfo,
    dependencies,
  );
}

/** Requests and parses FiveM's fixed `dynamic.json` endpoint. */
export function queryFiveMDynamic(
  options: EndpointOptions,
  dependencies: FiveMQueryDependencies = {},
): Promise<FiveMEndpointResult<FiveMDynamic>> {
  return queryEndpoint(
    options,
    "fivem-dynamic",
    DYNAMIC_PATH,
    DYNAMIC_MAX_BYTES,
    parseFiveMDynamic,
    dependencies,
  );
}

/** Requests and parses FiveM's fixed `players.json` endpoint. */
export function queryFiveMPlayers(
  options: EndpointOptions,
  dependencies: FiveMQueryDependencies = {},
): Promise<FiveMEndpointResult<readonly FiveMPlayer[]>> {
  return queryEndpoint(
    options,
    "fivem-players",
    PLAYERS_PATH,
    PLAYERS_MAX_BYTES,
    parseFiveMPlayers,
    dependencies,
  );
}
