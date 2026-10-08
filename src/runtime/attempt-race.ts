/** Staggered racing of one required source across validated connection candidates. */

import type { QuerySourceName } from "../contracts/shared.js";
import type { ExecutionScope } from "./execution.js";

/** Delay before the next candidate starts while earlier attempts are still pending (RFC 8305). */
export const ATTEMPT_STAGGER_MS = 250;

/** Inputs for one staggered race. */
export interface AttemptRaceOptions<C> {
  readonly scope: ExecutionScope;
  /** Candidates in preference order; each starts at most once. */
  readonly candidates: readonly C[];
  /** Per-attempt budget, capped by `scope`. */
  readonly operationTimeoutMs: number;
  readonly source: QuerySourceName;
  readonly staggerMs?: number;
  /** Error raised when `scope` terminates before any attempt succeeds. */
  readonly terminated: () => Error;
  /** Error raised when `candidates` is empty. */
  readonly empty: () => Error;
}

/** The first successful attempt and the candidate that produced it. */
export interface AttemptRaceWin<C, T> {
  readonly candidate: C;
  readonly value: T;
}

/**
 * Starts the first candidate, then the next one after `staggerMs` or as soon as an attempt fails,
 * whichever comes first. The first success wins and closes every other attempt's scope, so a dead
 * early address costs one stagger interval instead of its whole operation budget.
 *
 * When every attempt fails, the error from the last candidate is raised, matching sequential
 * fallback. Root termination always raises `terminated()`.
 */
export function raceAttempts<C, T>(
  options: AttemptRaceOptions<C>,
  attempt: (candidate: C, operation: ExecutionScope) => Promise<T>,
): Promise<AttemptRaceWin<C, T>> {
  const { scope, candidates } = options;
  if (scope.signal.aborted) {
    return Promise.reject(options.terminated());
  }
  if (candidates.length === 0) {
    return Promise.reject(options.empty());
  }
  const staggerMs = options.staggerMs ?? ATTEMPT_STAGGER_MS;

  return new Promise<AttemptRaceWin<C, T>>((resolve, reject): void => {
    const operations: ExecutionScope[] = [];
    let lastError: Error | undefined;
    let nextIndex = 0;
    let pending = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const clearTimer = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    const finish = (settle: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer();
      scope.signal.removeEventListener("abort", handleAbort);
      for (const operation of operations) {
        operation.close();
      }
      settle();
    };
    const handleAbort = (): void => {
      finish(() => {
        reject(options.terminated());
      });
    };

    const startNext = (): void => {
      clearTimer();
      const candidate = candidates[nextIndex];
      if (settled || candidate === undefined) {
        return;
      }
      nextIndex += 1;
      const isLast = nextIndex === candidates.length;
      const operation = scope.createOperation(options.operationTimeoutMs, options.source);
      operations.push(operation);
      pending += 1;

      const run = async (): Promise<void> => {
        let value: T;
        try {
          value = await attempt(candidate, operation);
        } catch (error) {
          operation.close();
          pending -= 1;
          if (isLast) {
            lastError = error instanceof Error ? error : new Error("The attempt failed.");
          }
          if (settled) {
            return;
          }
          if (scope.signal.aborted) {
            handleAbort();
          } else if (nextIndex < candidates.length) {
            startNext();
          } else if (pending === 0) {
            finish(() => {
              reject(lastError ?? new Error("The attempt failed."));
            });
          }
          return;
        }
        operation.close();
        finish(() => {
          resolve(Object.freeze({ candidate, value }));
        });
      };
      void run();

      if (!isLast) {
        timer = setTimeout(startNext, staggerMs);
      }
    };

    scope.signal.addEventListener("abort", handleAbort, { once: true });
    startNext();
  });
}
