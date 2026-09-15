/** Strict parsers and fixed-path requests for the public Cfx FXServer JSON endpoints. */

import type { CfxPlayer } from "../../contracts/games.js";
import type { QueryError, QuerySourceName, QuerySourceStatus } from "../../contracts/shared.js";
import type { PinnedAddress, PinnedTarget } from "../../network/target.js";
import type { ExecutionScope } from "../../runtime/execution.js";
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

/** Source identities and caller-facing label for one Cfx game profile. */
export interface CfxEndpointDefinition {
  readonly gameName: string;
  readonly sources: {
    readonly info: QuerySourceName;
    readonly dynamic: QuerySourceName;
    readonly players: QuerySourceName;
  };
}

/** Parsed facts from Cfx's `info.json`. */
export interface CfxInfo {
  readonly server?: string;
  readonly resources?: readonly string[];
  readonly variables?: Readonly<Record<string, string>>;
  readonly oneSyncEnabled?: boolean;
  readonly enhancedHostSupport?: boolean;
}

/** Parsed facts from Cfx's `dynamic.json`. */
export interface CfxDynamic {
  readonly hostname?: string;
  readonly mapName?: string;
  readonly gameType?: string;
  readonly clients?: number;
  readonly maxClients?: number;
}

/** One successful fixed endpoint response. */
export interface CfxEndpointResult<T> {
  readonly value: T;
  readonly rttMs: number;
}

/** A source-owned endpoint failure with stable provenance and public-safe error details. */
export class CfxEndpointError extends Error {
  public override readonly name = "CfxEndpointError";
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

/** Injectable HTTP boundary used by all three Cfx sources. */
export interface CfxQueryDependencies {
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

function malformed(source: QuerySourceName, gameName: string): never {
  throw new CfxEndpointError(source, "malformed", {
    code: "MALFORMED_RESPONSE",
    message: `The ${gameName} endpoint returned malformed JSON data.`,
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

function parseJson(data: Uint8Array, source: QuerySourceName, gameName: string): JsonValue {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return malformed(source, gameName);
  }
  const blockedBody = text.trim();
  if (blockedBody === "Nope" || blockedBody === "Nope.") {
    throw new CfxEndpointError(source, "blocked", {
      code: "CONNECTION_FAILED",
      message: `The ${gameName} endpoint blocked this request.`,
      source,
    });
  }
  try {
    const value = JSON.parse(text) as JsonValue;
    validateJsonBudget(value);
    return value;
  } catch {
    return malformed(source, gameName);
  }
}

function optionalString(
  object: JsonObject,
  key: string,
  source: QuerySourceName,
  gameName: string,
): string | undefined {
  const value = object[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length > MAX_SHORT_STRING_LENGTH) {
    return malformed(source, gameName);
  }
  return value;
}

function optionalBoolean(
  object: JsonObject,
  key: string,
  source: QuerySourceName,
  gameName: string,
): boolean | undefined {
  const value = object[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    return malformed(source, gameName);
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
  gameName: string,
): number {
  const value = nonNegativeInteger(object[key]);
  return value ?? malformed(source, gameName);
}

function parseStringArray(
  value: JsonValue | undefined,
  source: QuerySourceName,
  gameName: string,
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_ITEMS) {
    return malformed(source, gameName);
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length > MAX_SHORT_STRING_LENGTH) {
      return malformed(source, gameName);
    }
    result.push(entry);
  }
  return Object.freeze(result);
}

function parseVariables(
  value: JsonValue | undefined,
  source: QuerySourceName,
  gameName: string,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isObject(value)) {
    return malformed(source, gameName);
  }
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" || entry.length > MAX_SHORT_STRING_LENGTH) {
      return malformed(source, gameName);
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
export function parseCfxInfo(data: Uint8Array, definition: CfxEndpointDefinition): CfxInfo {
  const source = definition.sources.info;
  const value = parseJson(data, source, definition.gameName);
  if (!isObject(value)) {
    return malformed(source, definition.gameName);
  }
  const variables = parseVariables(value["vars"], source, definition.gameName);
  const server = optionalString(value, "server", source, definition.gameName);
  const resources = parseStringArray(value["resources"], source, definition.gameName);
  const oneSyncEnabled =
    variables === undefined ? undefined : parseBooleanString(variables["onesync_enabled"]);
  const enhancedHostSupport = optionalBoolean(
    value,
    "enhancedHostSupport",
    source,
    definition.gameName,
  );
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
  gameName: string,
): number | undefined {
  const raw = object[key];
  if (raw === undefined) {
    return undefined;
  }
  const numeric =
    typeof raw === "string" && /^\d+$/u.test(raw) ? Number(raw) : nonNegativeInteger(raw);
  if (numeric === undefined || !Number.isSafeInteger(numeric) || numeric < 0) {
    return malformed(source, gameName);
  }
  return numeric;
}

/** Parses one bounded `dynamic.json` body without retaining unknown fields. */
export function parseCfxDynamic(data: Uint8Array, definition: CfxEndpointDefinition): CfxDynamic {
  const source = definition.sources.dynamic;
  const value = parseJson(data, source, definition.gameName);
  if (!isObject(value)) {
    return malformed(source, definition.gameName);
  }
  const hostname = optionalString(value, "hostname", source, definition.gameName);
  const mapName = optionalString(value, "mapname", source, definition.gameName);
  const gameType = optionalString(value, "gametype", source, definition.gameName);
  const clients = optionalInteger(value, "clients", source, definition.gameName);
  const maxClients = optionalInteger(value, "sv_maxclients", source, definition.gameName);
  return Object.freeze({
    ...(hostname === undefined ? {} : { hostname }),
    ...(mapName === undefined ? {} : { mapName }),
    ...(gameType === undefined ? {} : { gameType }),
    ...(clients === undefined ? {} : { clients }),
    ...(maxClients === undefined ? {} : { maxClients }),
  });
}

/** Parses one bounded `players.json` body into the stable public player contract. */
export function parseCfxPlayers(
  data: Uint8Array,
  definition: CfxEndpointDefinition,
): readonly CfxPlayer[] {
  const source = definition.sources.players;
  const value = parseJson(data, source, definition.gameName);
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_ITEMS) {
    return malformed(source, definition.gameName);
  }
  const result: CfxPlayer[] = [];
  for (const entry of value) {
    if (!isObject(entry)) {
      return malformed(source, definition.gameName);
    }
    const name = optionalString(entry, "name", source, definition.gameName);
    if (name === undefined) {
      return malformed(source, definition.gameName);
    }
    const id = requiredNonNegativeInteger(entry, "id", source, definition.gameName);
    const pingRaw = entry["ping"];
    const ping = pingRaw === undefined ? undefined : nonNegativeInteger(pingRaw);
    if (pingRaw !== undefined && ping === undefined) {
      return malformed(source, definition.gameName);
    }
    result.push(Object.freeze({ id, name, ...(ping === undefined ? {} : { ping }) }));
  }
  return Object.freeze(result);
}

function endpointFailure(
  source: QuerySourceName,
  gameName: string,
  statusCode: number,
  data: Uint8Array,
): never {
  const trimmed = new TextDecoder().decode(data).trim();
  if (trimmed === "Nope" || trimmed === "Nope.") {
    throw new CfxEndpointError(source, "blocked", {
      code: "CONNECTION_FAILED",
      message: `The ${gameName} endpoint blocked this request.`,
      source,
    });
  }
  if (statusCode === 404) {
    throw new CfxEndpointError(source, "unsupported", {
      code: "CONNECTION_FAILED",
      message: `The ${gameName} endpoint was not found.`,
      source,
    });
  }
  throw new CfxEndpointError(source, "failed", {
    code: "CONNECTION_FAILED",
    message: `The ${gameName} endpoint request failed.`,
    source,
  });
}

async function queryEndpoint<T>(
  options: EndpointOptions,
  source: QuerySourceName,
  gameName: string,
  path: string,
  maxResponseBytes: number,
  parse: (data: Uint8Array) => T,
  dependencies: CfxQueryDependencies,
): Promise<CfxEndpointResult<T>> {
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
      return endpointFailure(source, gameName, response.statusCode, response.data);
    }
    return Object.freeze({ value: parse(response.data), rttMs: response.rttMs });
  } catch (error) {
    if (error instanceof CfxEndpointError) {
      throw error;
    }
    if (error instanceof HttpTransportError) {
      const status: QuerySourceStatus =
        error.code === "TIMEOUT"
          ? "timeout"
          : error.code === "MALFORMED_RESPONSE" || error.code === "RESPONSE_TOO_LARGE"
            ? "malformed"
            : "failed";
      throw new CfxEndpointError(source, status, {
        code: error.code,
        message: error.message,
        source,
      });
    }
    throw error;
  }
}

/** Requests and parses Cfx's fixed `info.json` endpoint. */
export function queryCfxInfo(
  options: EndpointOptions,
  definition: CfxEndpointDefinition,
  dependencies: CfxQueryDependencies = {},
): Promise<CfxEndpointResult<CfxInfo>> {
  return queryEndpoint(
    options,
    definition.sources.info,
    definition.gameName,
    INFO_PATH,
    INFO_MAX_BYTES,
    (data) => parseCfxInfo(data, definition),
    dependencies,
  );
}

/** Requests and parses Cfx's fixed `dynamic.json` endpoint. */
export function queryCfxDynamic(
  options: EndpointOptions,
  definition: CfxEndpointDefinition,
  dependencies: CfxQueryDependencies = {},
): Promise<CfxEndpointResult<CfxDynamic>> {
  return queryEndpoint(
    options,
    definition.sources.dynamic,
    definition.gameName,
    DYNAMIC_PATH,
    DYNAMIC_MAX_BYTES,
    (data) => parseCfxDynamic(data, definition),
    dependencies,
  );
}

/** Requests and parses Cfx's fixed `players.json` endpoint. */
export function queryCfxPlayers(
  options: EndpointOptions,
  definition: CfxEndpointDefinition,
  dependencies: CfxQueryDependencies = {},
): Promise<CfxEndpointResult<readonly CfxPlayer[]>> {
  return queryEndpoint(
    options,
    definition.sources.players,
    definition.gameName,
    PLAYERS_PATH,
    PLAYERS_MAX_BYTES,
    (data) => parseCfxPlayers(data, definition),
    dependencies,
  );
}
