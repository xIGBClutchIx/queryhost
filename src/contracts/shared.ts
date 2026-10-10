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

/** Stable identifier for a protocol or discovery source used by a game profile. */
export type QuerySourceName =
  | "a2s-info"
  | "a2s-player"
  | "a2s-rules"
  | "minecraft-srv"
  | "minecraft-slp"
  | "minecraft-query"
  | "minecraft-bedrock-raknet"
  | "fivem-info"
  | "fivem-dynamic"
  | "fivem-players"
  | "redm-info"
  | "redm-dynamic"
  | "redm-players"
  | "satisfactory-lightweight"
  | "satisfactory-health"
  | "vintage-story-query"
  | "eco-frontpage";

/** Outcome of an individual source, independent from the overall query result. */
export type QuerySourceStatus =
  "ok" | "timeout" | "blocked" | "malformed" | "unsupported" | "not-requested" | "failed";

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

/** Machine-readable warning codes for successful but incomplete results. */
export type QueryWarningCode =
  | "PARTIAL_RESULT"
  | "PLAYER_LIST_UNAVAILABLE"
  | "SOURCE_BLOCKED"
  | "SOURCE_FAILED"
  | "SOURCE_MALFORMED"
  | "SOURCE_TIMEOUT";

/** Non-fatal condition attached to a successful query. */
export interface QueryWarning {
  readonly code: QueryWarningCode;
  readonly message: string;
  readonly source?: QuerySourceName;
}

/** Stable failure codes suitable for programmatic branching. */
export type QueryErrorCode =
  | "ABORTED"
  | "CONNECTION_FAILED"
  | "DNS_FAILED"
  | "INTERNAL_ERROR"
  | "INVALID_INPUT"
  | "MALFORMED_RESPONSE"
  | "RESPONSE_TOO_LARGE"
  | "TARGET_BLOCKED"
  | "TIMEOUT";

/** Stable public failure information; implementation exceptions are never exposed here. */
export interface QueryError {
  readonly code: QueryErrorCode;
  readonly message: string;
  readonly source?: QuerySourceName;
}
