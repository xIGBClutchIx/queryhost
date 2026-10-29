/** Shared normalized public contracts used by every game profile. */

/** Controls whether a profile performs only its primary query or optional enrichment work too. */
export type QueryMode = "summary" | "full";

/** Player counts that are genuinely common across supported protocols. */
export interface ServerPlayers {
  readonly online?: number;
  readonly max?: number;
}

/**
 * Common server information shared across games.
 *
 * Optional properties are omitted when a source cannot confirm them. Missing data is never
 * replaced with a misleading zero, `false`, or empty value.
 */
export interface ServerInfo {
  readonly name?: string;
  readonly map?: string;
  readonly version?: string;
  readonly password?: boolean;
  readonly players?: ServerPlayers;
  /** Round-trip time for the primary query exchange, not ICMP latency. */
  readonly queryRttMs?: number;
}

// Each vocabulary union below is derived from its frozen tuple, so the runtime list and the type
// cannot drift. The explicit tuple annotations are required by `isolatedDeclarations`, and the
// compiler rejects any value that differs from them in membership or order.

/** Every {@link QuerySourceName}, in declaration order. */
export const QUERY_SOURCE_NAMES: readonly [
  "a2s-info",
  "a2s-player",
  "a2s-rules",
  "minecraft-srv",
  "minecraft-slp",
  "minecraft-legacy-ping",
  "minecraft-query",
  "minecraft-bedrock-raknet",
  "minecraft-bedrock-nethernet",
  "fivem-info",
  "fivem-dynamic",
  "fivem-players",
  "redm-info",
  "redm-dynamic",
  "redm-players",
  "satisfactory-lightweight",
  "satisfactory-health",
  "vintage-story-query",
  "eco-frontpage",
  "project-reclaimer-status",
] = Object.freeze([
  "a2s-info",
  "a2s-player",
  "a2s-rules",
  "minecraft-srv",
  "minecraft-slp",
  "minecraft-legacy-ping",
  "minecraft-query",
  "minecraft-bedrock-raknet",
  "minecraft-bedrock-nethernet",
  "fivem-info",
  "fivem-dynamic",
  "fivem-players",
  "redm-info",
  "redm-dynamic",
  "redm-players",
  "satisfactory-lightweight",
  "satisfactory-health",
  "vintage-story-query",
  "eco-frontpage",
  "project-reclaimer-status",
] as const);

/** Stable identifier for a protocol or discovery source used by a game profile. */
export type QuerySourceName = (typeof QUERY_SOURCE_NAMES)[number];

/**
 * Short display label for each query source, such as `Players` or `Front page`. Labels are meant to
 * appear beside the game's name, so they need not be unique across games.
 */
export const QUERY_SOURCE_LABELS: Readonly<Record<QuerySourceName, string>> = Object.freeze({
  "a2s-info": "Info",
  "a2s-player": "Players",
  "a2s-rules": "Rules",
  "minecraft-srv": "SRV",
  "minecraft-slp": "Status",
  "minecraft-legacy-ping": "Legacy ping",
  "minecraft-query": "Query",
  "minecraft-bedrock-raknet": "Bedrock ping",
  "minecraft-bedrock-nethernet": "NetherNet status",
  "fivem-info": "Server info",
  "fivem-dynamic": "Status",
  "fivem-players": "Players",
  "redm-info": "Server info",
  "redm-dynamic": "Status",
  "redm-players": "Players",
  "satisfactory-lightweight": "Server state",
  "satisfactory-health": "Health",
  "vintage-story-query": "Server query",
  "eco-frontpage": "Front page",
  "project-reclaimer-status": "Server browser",
});

/** Every {@link QuerySourceStatus}, in declaration order. */
export const QUERY_SOURCE_STATUSES: readonly [
  "ok",
  "timeout",
  "blocked",
  "malformed",
  "unsupported",
  "not-requested",
  "failed",
] = Object.freeze([
  "ok",
  "timeout",
  "blocked",
  "malformed",
  "unsupported",
  "not-requested",
  "failed",
] as const);

/** Outcome of an individual source, independent from the overall query result. */
export type QuerySourceStatus = (typeof QUERY_SOURCE_STATUSES)[number];

/** Provenance report for one attempted, skipped, or unavailable source. */
export interface QuerySource {
  readonly source: QuerySourceName;
  readonly status: QuerySourceStatus;
  /** Source-specific exchange time when an exchange completed. */
  readonly rttMs?: number;
}

/**
 * Progress for one source of a running query, delivered through `QueryInput.onSource`.
 *
 * `started` fires before a source's network work begins. `completed` carries the same report that
 * appears in the result's `sources`; skipped and unsupported sources complete without starting.
 */
export type QuerySourceEvent =
  | { readonly type: "started"; readonly source: QuerySourceName }
  | { readonly type: "completed"; readonly report: QuerySource };

/**
 * What a stable error or warning code means and how a caller typically responds to it, as short
 * English sentences for documentation and user interfaces.
 */
export interface CodeGuidance {
  /** What happened when a result carries the code. */
  readonly meaning: string;
  /** What a caller typically does about it. */
  readonly response: string;
}

/** Builds one frozen guidance entry, so a published table cannot be changed at run time. */
export function codeGuidance(meaning: string, response: string): CodeGuidance {
  return Object.freeze({ meaning, response });
}

/** Every {@link QueryWarningCode}, in declaration order. */
export const QUERY_WARNING_CODES: readonly [
  "PARTIAL_RESULT",
  "PLAYER_LIST_UNAVAILABLE",
  "SOURCE_BLOCKED",
  "SOURCE_FAILED",
  "SOURCE_MALFORMED",
  "SOURCE_TIMEOUT",
] = Object.freeze([
  "PARTIAL_RESULT",
  "PLAYER_LIST_UNAVAILABLE",
  "SOURCE_BLOCKED",
  "SOURCE_FAILED",
  "SOURCE_MALFORMED",
  "SOURCE_TIMEOUT",
] as const);

/** Machine-readable warning codes for successful but incomplete results. */
export type QueryWarningCode = (typeof QUERY_WARNING_CODES)[number];

/** Non-fatal condition attached to a successful query. */
export interface QueryWarning {
  readonly code: QueryWarningCode;
  readonly message: string;
  readonly source?: QuerySourceName;
}

/** What each {@link QueryWarningCode} means and the typical response, in declaration order. */
export const QUERY_WARNING_GUIDANCE: Readonly<Record<QueryWarningCode, CodeGuidance>> =
  Object.freeze({
    PARTIAL_RESULT: codeGuidance(
      "One or more optional sources did not complete.",
      "Use the result; check sources for what is missing.",
    ),
    PLAYER_LIST_UNAVAILABLE: codeGuidance(
      "The player list could not be read; counts may still be present.",
      "Show the count without names.",
    ),
    SOURCE_BLOCKED: codeGuidance(
      "An optional source's destination was not allowed.",
      "Use the result without that source.",
    ),
    SOURCE_FAILED: codeGuidance(
      "An optional source failed to connect or answer.",
      "Use the result without that source.",
    ),
    SOURCE_MALFORMED: codeGuidance(
      "An optional source answered with data that does not match its protocol.",
      "Use the result without that source.",
    ),
    SOURCE_TIMEOUT: codeGuidance(
      "An optional source did not answer before the deadline.",
      "Use the result, or retry with a longer timeoutMs.",
    ),
  });

/** Every {@link QueryErrorCode}, in declaration order. */
export const QUERY_ERROR_CODES: readonly [
  "ABORTED",
  "CONNECTION_FAILED",
  "DNS_FAILED",
  "INTERNAL_ERROR",
  "INVALID_INPUT",
  "MALFORMED_RESPONSE",
  "RESPONSE_TOO_LARGE",
  "TARGET_BLOCKED",
  "TIMEOUT",
] = Object.freeze([
  "ABORTED",
  "CONNECTION_FAILED",
  "DNS_FAILED",
  "INTERNAL_ERROR",
  "INVALID_INPUT",
  "MALFORMED_RESPONSE",
  "RESPONSE_TOO_LARGE",
  "TARGET_BLOCKED",
  "TIMEOUT",
] as const);

/** Stable failure codes suitable for programmatic branching. */
export type QueryErrorCode = (typeof QUERY_ERROR_CODES)[number];

/** Stable public failure information; implementation exceptions are never exposed here. */
export interface QueryError {
  readonly code: QueryErrorCode;
  readonly message: string;
  readonly source?: QuerySourceName;
}

/** What each {@link QueryErrorCode} means and the typical response, in declaration order. */
export const QUERY_ERROR_GUIDANCE: Readonly<Record<QueryErrorCode, CodeGuidance>> = Object.freeze({
  ABORTED: codeGuidance(
    "The caller's signal cancelled the query.",
    "Respect the cancellation; do not retry on the caller's behalf.",
  ),
  CONNECTION_FAILED: codeGuidance(
    "The server refused or closed the connection, or answered with an error status.",
    "Retry later; the server may be down or the port closed.",
  ),
  DNS_FAILED: codeGuidance(
    "The hostname did not resolve to a usable address.",
    "Check the hostname; retry only if DNS may be briefly unavailable.",
  ),
  INTERNAL_ERROR: codeGuidance(
    "An unexpected implementation failure, kept out of the result's details.",
    "Log it outside the result and report it.",
  ),
  INVALID_INPUT: codeGuidance(
    "The game, host, port, mode, or deadline is not valid.",
    "Correct the request; do not retry unchanged.",
  ),
  MALFORMED_RESPONSE: codeGuidance(
    "The server answered with data that does not match its protocol.",
    "Treat the source as unusable; check the game and port.",
  ),
  RESPONSE_TOO_LARGE: codeGuidance(
    "The response exceeded the protocol's size limits.",
    "Treat the source as unusable; limits are not negotiable.",
  ),
  TARGET_BLOCKED: codeGuidance(
    "The destination is not a public address the safety policy allows.",
    "Use a public host; do not retry unchanged.",
  ),
  TIMEOUT: codeGuidance(
    "The required source did not answer before the query deadline.",
    "Retry with backoff, or raise timeoutMs.",
  ),
});
