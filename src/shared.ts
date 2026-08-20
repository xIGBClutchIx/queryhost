export type QueryMode = "summary" | "full";

export interface ServerPlayers {
  readonly online?: number;
  readonly max?: number;
}

export interface ServerInfo {
  readonly name?: string;
  readonly map?: string;
  readonly version?: string;
  readonly password?: boolean;
  readonly players?: ServerPlayers;
  readonly queryRttMs?: number;
}

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
  | "fivem-players";

export type QuerySourceStatus =
  "ok" | "timeout" | "blocked" | "malformed" | "unsupported" | "not-requested";

export interface QuerySource {
  readonly source: QuerySourceName;
  readonly status: QuerySourceStatus;
  readonly rttMs?: number;
}

export type QueryWarningCode =
  | "PARTIAL_RESULT"
  | "PLAYER_LIST_UNAVAILABLE"
  | "SOURCE_BLOCKED"
  | "SOURCE_MALFORMED"
  | "SOURCE_TIMEOUT";

export interface QueryWarning {
  readonly code: QueryWarningCode;
  readonly message: string;
  readonly source?: QuerySourceName;
}

export type QueryErrorCode =
  | "ABORTED"
  | "CONNECTION_FAILED"
  | "DNS_FAILED"
  | "INTERNAL_ERROR"
  | "INVALID_INPUT"
  | "MALFORMED_RESPONSE"
  | "TARGET_BLOCKED"
  | "TIMEOUT"
  | "UNSUPPORTED_GAME";

export interface QueryError {
  readonly code: QueryErrorCode;
  readonly message: string;
  readonly source?: QuerySourceName;
}
