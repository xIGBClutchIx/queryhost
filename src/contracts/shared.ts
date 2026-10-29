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
