/** Bounded fan-out of independent queries for dashboards, server lists, and bots. */

import type {
  CanonicalGameId,
  GameInputId,
  QueryFailure,
  QueryInput,
  QueryManyEntry,
  QueryManyOptions,
  QueryResult,
} from "../contracts/query.js";
import { canonicalGameId, isGameInputId } from "../contracts/registry.js";

const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 64;

/** One query as `queryMany()` runs it; injected so batching is testable without the network. */
export type QueryRunner<G extends GameInputId> = (
  input: QueryInput<G>,
) => Promise<QueryResult<CanonicalGameId<G>>>;

/** `queryMany()` is reachable from untyped JavaScript, so its declared types are not guarantees. */
type UntypedInputs<G extends GameInputId> = Iterable<QueryInput<G>> | null | undefined;
type UntypedOptions = QueryManyOptions | null;

function normalizeConcurrency(options: QueryManyOptions | undefined): number {
  const value = options?.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CONCURRENCY) {
    throw new RangeError(
      `queryMany concurrency must be an integer from 1 through ${MAX_CONCURRENCY}.`,
    );
  }
  return value;
}

function validateBatch<G extends GameInputId>(
  inputs: UntypedInputs<G>,
  options: UntypedOptions | undefined,
): void {
  const iterator: (() => Iterator<QueryInput<G>>) | undefined =
    typeof inputs === "object" && inputs !== null ? inputs[Symbol.iterator] : undefined;
  if (typeof iterator !== "function") {
    throw new TypeError("queryMany inputs must be iterable.");
  }
  if (options === null || (options !== undefined && typeof options !== "object")) {
    throw new TypeError("queryMany options must be an object.");
  }
  const signal: AbortSignal | string | object | null | undefined = options?.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError("queryMany signal must be an AbortSignal.");
  }
}

/** A runner that rejects still yields one entry, so one target can never fail the whole batch. */
function internalFailure<G extends GameInputId>(
  input: QueryInput<G>,
): QueryFailure<CanonicalGameId<G>> {
  const game: string | number | object | null | undefined =
    typeof input === "object" && input !== null ? input.game : undefined;
  return Object.freeze({
    ok: false,
    // Only an unregistered game from untyped JavaScript reaches the echo, as `query()` does.
    game: (typeof game === "string" && isGameInputId(game)
      ? canonicalGameId(game)
      : game) as CanonicalGameId<G>,
    error: Object.freeze({ code: "INTERNAL_ERROR", message: "The query could not be completed." }),
    durationMs: 0,
    sources: Object.freeze([]),
    warnings: Object.freeze([]),
  });
}

/** Adds the batch signal to one input while leaving inputs `query()` will reject untouched. */
function withBatchSignal<G extends GameInputId>(
  input: QueryInput<G>,
  batchSignal: AbortSignal,
): QueryInput<G> {
  if (typeof input !== "object" || input === null) {
    return input;
  }
  const signal: AbortSignal | string | object | null | undefined = input.signal;
  if (signal === undefined) {
    return { ...input, signal: batchSignal };
  }
  return signal instanceof AbortSignal
    ? { ...input, signal: AbortSignal.any([signal, batchSignal]) }
    : input;
}

async function runOne<G extends GameInputId>(
  index: number,
  input: QueryInput<G>,
  batchSignal: AbortSignal,
  run: QueryRunner<G>,
): Promise<QueryManyEntry<G>> {
  let result: QueryResult<CanonicalGameId<G>>;
  try {
    result = await run(withBatchSignal(input, batchSignal));
  } catch {
    result = internalFailure(input);
  }
  return Object.freeze({ index, input, result });
}

async function* runBatch<G extends GameInputId>(
  inputs: Iterable<QueryInput<G>>,
  concurrency: number,
  signal: AbortSignal | undefined,
  run: QueryRunner<G>,
): AsyncGenerator<QueryManyEntry<G>, void, undefined> {
  // Aborted when the consumer stops early so in-flight queries end instead of running unobserved.
  const stop = new AbortController();
  const batchSignal = signal === undefined ? stop.signal : AbortSignal.any([signal, stop.signal]);
  const running = new Map<number, Promise<QueryManyEntry<G>>>();
  let iterator: Iterator<QueryInput<G>> | undefined;
  let exhausted = false;
  let nextIndex = 0;

  try {
    iterator = inputs[Symbol.iterator]();
    for (;;) {
      // A result waiting for the consumer still holds its slot, so a slow consumer applies
      // backpressure and buffered results never exceed the concurrency limit.
      while (!exhausted && !batchSignal.aborted && running.size < concurrency) {
        let step: IteratorResult<QueryInput<G>>;
        try {
          step = iterator.next();
        } catch (error) {
          exhausted = true;
          throw error;
        }
        if (step.done === true) {
          exhausted = true;
          break;
        }
        const index = nextIndex++;
        running.set(index, runOne(index, step.value, batchSignal, run));
      }
      if (running.size === 0) {
        return;
      }
      const entry = await Promise.race(running.values());
      running.delete(entry.index);
      yield entry;
    }
  } finally {
    stop.abort();
    await Promise.all(running.values());
    if (!exhausted) {
      iterator?.return?.();
    }
  }
}

/** Internal dependency-injected form of `queryMany()`; not exported from the package root. */
export function queryManyWith<G extends GameInputId>(
  inputs: Iterable<QueryInput<G>>,
  options: QueryManyOptions | undefined,
  run: QueryRunner<G>,
): AsyncGenerator<QueryManyEntry<G>, void, undefined> {
  validateBatch(inputs, options);
  return runBatch(inputs, normalizeConcurrency(options), options?.signal, run);
}
