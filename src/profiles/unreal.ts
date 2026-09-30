/** Unreal Engine Steam session conventions shared by several games' A2S keywords and Rules. */

import type { SteamA2sData, UnrealSessionData, UnrealSessionFlags } from "../contracts/games.js";
import type { A2sRules } from "../protocols/a2s/rules.js";
import type { A2sProfileOptions } from "./a2s.js";
import { querySteamA2sGame, type SteamA2sProfileResult } from "./steam-a2s.js";
import { booleanValue, integerValue, optionalField, textValue, unsignedValue } from "./values.js";

const SESSION_FLAGS: readonly (keyof UnrealSessionFlags)[] = [
  "advertised",
  "joinInProgress",
  "lan",
  "dedicated",
  "usesStats",
  "invites",
  "usesPresence",
  "joinViaPresence",
  "joinViaPresenceFriendsOnly",
  "antiCheatProtected",
];
const MAX_SESSION_FLAGS = (1 << SESSION_FLAGS.length) - 1;
const KEY = /^[A-Za-z0-9_]+:/u;

/**
 * Parses Unreal's `BUILDID:n,KEY:VALUE,...` keywords. The engine drops a whole pair that would
 * overflow Steam's tag limit, so pairs are never truncated, but values such as `OWNINGNAME` can
 * contain commas; a segment without its own `KEY:` prefix continues the previous value.
 */
function keywordValues(keywords: string | undefined): Map<string, string> {
  const values = new Map<string, string>();
  let current: string | undefined;
  for (const segment of (keywords ?? "").split(",")) {
    if (KEY.test(segment)) {
      const separator = segment.indexOf(":");
      current = segment.slice(0, separator);
      if (values.has(current)) {
        // A repeated key is ambiguous; keep the first and ignore continuations of the second.
        current = undefined;
      } else {
        values.set(current, segment.slice(separator + 1));
      }
    } else if (current !== undefined) {
      values.set(current, `${values.get(current) ?? ""},${segment}`);
    }
  }
  return values;
}

/** Merges keyword pairs with Rules, letting Rules win because they are not length-limited. */
export function unrealSessionValues(
  keywords: string | undefined,
  rules: A2sRules | undefined,
): ReadonlyMap<string, string> {
  const values = keywordValues(keywords);
  for (const [key, value] of Object.entries(rules ?? {})) {
    values.set(key, value);
  }
  return values;
}

function sessionFlags(value: string | undefined): UnrealSessionFlags | undefined {
  const bits = unsignedValue(value, MAX_SESSION_FLAGS);
  if (bits === undefined) {
    return undefined;
  }
  const flags: Record<keyof UnrealSessionFlags, boolean> = {
    advertised: false,
    joinInProgress: false,
    lan: false,
    dedicated: false,
    usesStats: false,
    invites: false,
    usesPresence: false,
    joinViaPresence: false,
    joinViaPresenceFriendsOnly: false,
    antiCheatProtected: false,
  };
  SESSION_FLAGS.forEach((flag, bit) => {
    flags[flag] = (bits & (1 << bit)) !== 0;
  });
  return Object.freeze(flags);
}

/** Types the session facts every Unreal Engine Steam server shares. */
export function unrealSessionData(values: ReadonlyMap<string, string>): UnrealSessionData {
  return {
    // A typed `BUILDID_i` rule comes only from Rules, so it takes precedence like other Rules.
    ...optionalField("buildId", integerValue(values.get("BUILDID_i") ?? values.get("BUILDID"))),
    ...optionalField("openPublicSlots", unsignedValue(values.get("NUMOPENPUBCONN"), 65_535)),
    ...optionalField("sessionFlags", sessionFlags(values.get("SESSIONFLAGS"))),
  };
}

/** Game-specific fields read from the merged Unreal session values. */
export type UnrealGameFields<D> = (values: ReadonlyMap<string, string>) => Partial<D>;

/** Queries an Unreal Engine Steam game and adds shared session facts plus `fields`. */
export async function queryUnrealSteamProfile<D extends SteamA2sData & UnrealSessionData>(
  options: A2sProfileOptions,
  gameName: string,
  fields: UnrealGameFields<D> = () => ({}),
): Promise<SteamA2sProfileResult<SteamA2sData & UnrealSessionData & Partial<D>>> {
  return querySteamA2sGame({ ...options, gameName }, ({ server, data, keywords, rules }) => {
    const values = unrealSessionValues(keywords, rules);
    return { server, data: { ...data, ...unrealSessionData(values), ...fields(values) } };
  });
}

/** Reads an Unreal `_b` session value, which the engine writes as `true` or `false`. */
export function unrealBoolean(value: string | undefined): boolean | undefined {
  return booleanValue(value, ["true"], ["false"]);
}

/** Reads a non-empty Unreal `_s` session value. */
export function unrealText(value: string | undefined): string | undefined {
  return textValue(value);
}
