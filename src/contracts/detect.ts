/** Public contracts for detecting which supported game a server runs. */

import type { GameId, QueryResult } from "./query.js";
import type { GameProtocol } from "./registry.js";
import type { QueryErrorCode, QueryMode } from "./shared.js";

/** Input accepted by `detect()`, which identifies the game instead of taking it from the caller. */
export interface DetectInput {
  /** DNS hostname or IP literal. URL syntax is intentionally not accepted. */
  readonly host: string;
  /**
   * Port the caller knows, tried both as a query port and as a game port whose conventional query
   * port is derived from the registry. When omitted, each game's conventional ports are probed.
   */
  readonly port?: number;
  /** Mode of the query returned for the detected game; defaults to `"full"`. */
  readonly mode?: QueryMode;
  /**
   * Global deadline for probing and the final query together, from 1 through 30,000 ms; defaults
   * to 5,000 ms.
   */
  readonly timeoutMs?: number;
  /** Caller cancellation propagated to every outstanding probe and query. */
  readonly signal?: AbortSignal;
  /** Distinct protocol and port pairs to probe, from 1 through 16; defaults to 8. */
  readonly maxProbes?: number;
}

/**
 * Protocol a probe speaks. Unreal Engine A2S games answer the same A2S request, so `a2s-unreal`
 * is probed as `a2s`.
 */
export type DetectProtocol = Exclude<GameProtocol, "a2s-unreal">;

/**
 * Outcome of one probe. `matched` answered and decided the result; `answered` also answered but
 * finished after the match; `cancelled` started and was stopped because another probe matched;
 * `skipped` never ran because the probe or time budget was spent first.
 */
export type DetectProbeStatus = "matched" | "answered" | "failed" | "cancelled" | "skipped";

/** One protocol and port pair `detect()` planned, in the order it was prioritized. */
export interface DetectProbe {
  readonly protocol: DetectProtocol;
  readonly port: number;
  readonly status: DetectProbeStatus;
  /** Present only when `status` is `failed`. */
  readonly error?: QueryErrorCode;
}

/**
 * How the detected game was told apart from the others its protocol serves.
 *
 * - `protocol`: the protocol that answered belongs to this game alone, such as Minecraft or Eco.
 * - `advertised`: the server named its game, through its A2S Steam App ID or Cfx `gamename`.
 * - `port`: several games share the protocol, and only this one conventionally uses the port.
 * - `fallback`: nothing identified a specific game, so the result uses the protocol's general
 *   profile, generic A2S or FiveM for Cfx.
 */
export type DetectEvidence = "protocol" | "advertised" | "port" | "fallback";

/** Stable failure codes for a detection in which no game was identified. */
export type DetectErrorCode =
  | Extract<QueryErrorCode, "ABORTED" | "DNS_FAILED" | "INVALID_INPUT" | "TARGET_BLOCKED">
  | "NOT_DETECTED";

/** Stable public detection failure; implementation exceptions are never exposed here. */
export interface DetectError {
  readonly code: DetectErrorCode;
  readonly message: string;
}

/**
 * Successful detection, correlated by game. `result` is the detected game's own query and can
 * still fail when the server stops answering between the probe and that query.
 */
export type DetectSuccess = {
  readonly [G in GameId]: {
    readonly ok: true;
    readonly game: G;
    readonly evidence: DetectEvidence;
    readonly result: QueryResult<G>;
    readonly probes: readonly DetectProbe[];
    /** Total wall-clock duration of probing and the final query. */
    readonly durationMs: number;
  };
}[GameId];

/** Detection in which no probe identified a supported game. */
export interface DetectFailure {
  readonly ok: false;
  readonly error: DetectError;
  readonly probes: readonly DetectProbe[];
  readonly durationMs: number;
}

/** Discriminated `detect()` result. */
export type DetectResult = DetectSuccess | DetectFailure;
