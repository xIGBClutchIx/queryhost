/** Strict parser and fixed-path request for the Eco web server's `/frontpage` status JSON. */

import type { PinnedAddress, PinnedTarget } from "../../network/target.js";
import type { ExecutionScope } from "../../runtime/execution.js";
import {
  fixedHttpExchange,
  type FixedHttpExchangeOptions,
  type FixedHttpExchangeResult,
  type HttpTransportDependencies,
} from "../../transports/http.js";
import { failEco } from "./errors.js";

const FRONTPAGE_PATH = "/frontpage";
/** Upper bound for one status page; real pages are a few kilobytes. */
export const ECO_FRONTPAGE_MAX_BYTES = 262_144;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 16_384;
const MAX_PLAYER_NAMES = 4_096;
const MAX_STRING_LENGTH = 16_384;

type JsonValue = boolean | null | number | string | JsonValue[] | JsonObject;
interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * Facts read from the `Info` object. Every field is optional because Eco releases add and drop
 * keys; an absent or `null` key is omitted, never replaced with a zero, `false`, or empty value.
 */
export interface EcoFrontpage {
  /** Server name as configured, including any Unity rich-text tags. */
  readonly description?: string;
  readonly detailedDescription?: string;
  readonly version?: string;
  readonly hasPassword?: boolean;
  readonly onlinePlayers?: number;
  readonly onlinePlayerNames?: readonly string[];
  readonly totalPlayers?: number;
  readonly activeAndOnlinePlayers?: number;
  readonly peakActivePlayers?: number;
  readonly maxActivePlayers?: number;
  readonly adminOnline?: boolean;
  readonly category?: string;
  readonly language?: string;
  readonly worldSize?: string;
  readonly economyDescription?: string;
  readonly skillSpecialization?: string;
  readonly playtimes?: string;
  readonly discordAddress?: string;
  readonly joinUrl?: string;
  readonly access?: string;
  readonly gamePort?: number;
  readonly webPort?: number;
  readonly external?: boolean;
  readonly lan?: boolean;
  readonly paused?: boolean;
  readonly meteor?: boolean;
  readonly timeSinceStartSeconds?: number;
  readonly timeLeftSeconds?: number;
  readonly animals?: number;
  readonly plants?: number;
  readonly laws?: number;
  readonly limitingHours?: boolean;
  readonly exhaustionAfterHours?: number;
}

/** Parsed status page and the request's complete round-trip duration. */
export interface EcoFrontpageResult {
  readonly frontpage: EcoFrontpage;
  readonly rttMs: number;
}

/** Inputs for one request against an address from an already validated target. */
export interface EcoFrontpageOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly address: PinnedAddress;
}

/** Injectable HTTP boundary used by deterministic profile tests. */
export interface EcoQueryDependencies {
  readonly http?: HttpTransportDependencies;
  readonly exchange?: (
    options: FixedHttpExchangeOptions,
    dependencies?: HttpTransportDependencies,
  ) => Promise<FixedHttpExchangeResult>;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateJsonBudget(value: JsonValue): void {
  let nodes = 0;
  const visit = (current: JsonValue, depth: number): void => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
      failEco("MALFORMED_RESPONSE");
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

function parseJson(data: Uint8Array): JsonValue {
  let value: JsonValue;
  try {
    // JSON.parse can only produce this recursive value domain; field validation follows.
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)) as JsonValue;
  } catch {
    return failEco("MALFORMED_RESPONSE");
  }
  validateJsonBudget(value);
  return value;
}

function present(info: JsonObject, key: string): JsonValue | undefined {
  const value = Object.hasOwn(info, key) ? info[key] : undefined;
  return value === null ? undefined : value;
}

function text(info: JsonObject, key: string): string | undefined {
  const value = present(info, key);
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" && value.length <= MAX_STRING_LENGTH
    ? value
    : failEco("MALFORMED_RESPONSE");
}

function flag(info: JsonObject, key: string): boolean | undefined {
  const value = present(info, key);
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "boolean" ? value : failEco("MALFORMED_RESPONSE");
}

function count(info: JsonObject, key: string): number | undefined {
  const value = present(info, key);
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : failEco("MALFORMED_RESPONSE");
}

function port(info: JsonObject, key: string): number | undefined {
  const value = count(info, key);
  return value === undefined || value <= 65_535 ? value : failEco("MALFORMED_RESPONSE");
}

function seconds(info: JsonObject, key: string): number | undefined {
  const value = present(info, key);
  if (value === undefined) {
    return undefined;
  }
  // The meteor countdown can pass zero, so only finiteness is a structural requirement.
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : failEco("MALFORMED_RESPONSE");
}

function names(info: JsonObject, key: string): readonly string[] | undefined {
  const value = present(info, key);
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > MAX_PLAYER_NAMES) {
    return failEco("MALFORMED_RESPONSE");
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length > MAX_STRING_LENGTH) {
      return failEco("MALFORMED_RESPONSE");
    }
    result.push(entry);
  }
  return Object.freeze(result);
}

/** Every field spelled out, so a key added to {@link EcoFrontpage} must be parsed here too. */
type EcoFrontpageFields = { readonly [K in keyof EcoFrontpage]-?: EcoFrontpage[K] | undefined };

function withoutOmitted(fields: EcoFrontpageFields): EcoFrontpage {
  // Dropping undefined entries turns each `T | undefined` field back into an omitted optional one.
  return Object.freeze(
    Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
  );
}

/** Parses one bounded `/frontpage` body without retaining unknown fields. */
export function parseEcoFrontpage(data: Uint8Array): EcoFrontpage {
  const root = parseJson(data);
  const info = isObject(root) ? root["Info"] : undefined;
  if (!isObject(info)) {
    return failEco("MALFORMED_RESPONSE");
  }
  return withoutOmitted({
    description: text(info, "Description"),
    detailedDescription: text(info, "DetailedDescription"),
    version: text(info, "Version"),
    hasPassword: flag(info, "HasPassword"),
    onlinePlayers: count(info, "OnlinePlayers"),
    onlinePlayerNames: names(info, "OnlinePlayersNames"),
    totalPlayers: count(info, "TotalPlayers"),
    activeAndOnlinePlayers: count(info, "ActiveAndOnlinePlayers"),
    peakActivePlayers: count(info, "PeakActivePlayers"),
    maxActivePlayers: count(info, "MaxActivePlayers"),
    adminOnline: flag(info, "AdminOnline"),
    category: text(info, "Category"),
    language: text(info, "Language"),
    worldSize: text(info, "WorldSize"),
    economyDescription: text(info, "EconomyDesc"),
    skillSpecialization: text(info, "SkillSpecializationSetting"),
    playtimes: text(info, "Playtimes"),
    discordAddress: text(info, "DiscordAddress"),
    joinUrl: text(info, "JoinUrl"),
    access: text(info, "Access"),
    gamePort: port(info, "GamePort"),
    webPort: port(info, "WebPort"),
    external: flag(info, "External"),
    lan: flag(info, "IsLAN"),
    paused: flag(info, "IsPaused"),
    meteor: flag(info, "HasMeteor"),
    timeSinceStartSeconds: seconds(info, "TimeSinceStart"),
    timeLeftSeconds: seconds(info, "TimeLeft"),
    animals: count(info, "Animals"),
    plants: count(info, "Plants"),
    laws: count(info, "Laws"),
    limitingHours: flag(info, "IsLimitingHours"),
    exhaustionAfterHours: seconds(info, "ExhaustionAfterHours"),
  });
}

const RICH_TEXT_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:=[^<>]*)?(?:\s[^<>]*)?>|<#[0-9A-Fa-f]{3,8}>/gu;

/** Removes the Unity rich-text tags Eco servers use to color and size their names. */
export function plainEcoText(value: string): string {
  return value.replace(RICH_TEXT_TAG, "").trim();
}

/** Requests and parses the fixed `/frontpage` endpoint from one pinned address. */
export async function queryEcoFrontpage(
  options: EcoFrontpageOptions,
  dependencies: EcoQueryDependencies = {},
): Promise<EcoFrontpageResult> {
  const response = await (dependencies.exchange ?? fixedHttpExchange)(
    {
      scope: options.scope,
      target: options.target,
      address: options.address,
      protocol: "http",
      path: FRONTPAGE_PATH,
      maxResponseBytes: ECO_FRONTPAGE_MAX_BYTES,
    },
    dependencies.http,
  );
  if (response.statusCode < 200 || response.statusCode > 299) {
    return failEco("CONNECTION_FAILED");
  }
  return Object.freeze({ frontpage: parseEcoFrontpage(response.data), rttMs: response.rttMs });
}
