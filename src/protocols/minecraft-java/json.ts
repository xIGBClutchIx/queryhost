/** Concrete JSON boundary types used before Minecraft status validation. */

import { failMinecraftJava } from "./errors.js";

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonValue = JsonObject | readonly JsonValue[] | boolean | number | string | null;

/** Parses syntactically valid JSON into the complete JSON value domain. */
export function parseJson(text: string): JsonValue {
  try {
    // JSON.parse can only produce this recursive value domain; semantic validation follows next.
    return JSON.parse(text) as JsonValue;
  } catch {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
}

/** Narrows one JSON value to a non-array object. */
export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrows one JSON value to an array without widening its elements. */
export function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}
