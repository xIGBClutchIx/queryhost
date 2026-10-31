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
import type { QueryError } from "../contracts/shared.js";
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

const INTERNAL_ERROR: QueryError = Object.freeze({
  code: "INTERNAL_ERROR",
  message: "The query could not be completed.",
});
const ABORTED_ERROR: QueryError = Object.freeze({
  code: "ABORTED",
  message: "The query was cancelled.",
});

/** A failure entry produced by the batch itself rather than by a query. */
function batchFailure<G extends GameInputId>(
  input: QueryInput<G>,
  error: QueryError,
): QueryFailure<CanonicalGameId<G>> {
  const game: string | number | object | null | undefined =
    typeof input === "object" && input !== null ? input.game : undefined;
  return Object.freeze({
    ok: false,
    // Only an unregistered game from untyped JavaScript reaches the echo, as `query()` does.
    game: (typeof game === "string" && isGameInputId(game)
      ? canonicalGameId(game)
      : game) as CanonicalGameId<G>,
    error,
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
    // A runner that rejects still yields one entry, so one target can never fail the whole batch.
    result = batchFailure(input, INTERNAL_ERROR);
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
  // Entries in the order they settled; racing already-settled promises would pick input order.
  const settled: QueryManyEntry<G>[] = [];
  let wake: (() => void) | undefined;
  let iterator: Iterator<QueryInput<G>> | undefined;
  let exhausted = false;
  let nextIndex = 0;

  // The next caller input step. Exhaustion is reported by `done`, never by the value, because an
  // untyped caller's input (or an array hole) can itself be `undefined` and must still yield an
  // entry of its own.
  const readNext = (source: Iterator<QueryInput<G>>): IteratorResult<QueryInput<G>> => {
    let step: IteratorResult<QueryInput<G>>;
    try {
      step = source.next();
    } catch (error) {
      exhausted = true;
      throw error;
    }
    if (step.done === true) {
      exhausted = true;
    }
    return step;
  };

  try {
    iterator = inputs[Symbol.iterator]();
    for (;;) {
      // A result waiting for the consumer still holds its slot, so a slow consumer applies
      // backpressure and buffered results never exceed the concurrency limit.
      while (!exhausted && !batchSignal.aborted && running.size < concurrency) {
        const step = readNext(iterator);
        if (step.done === true) {
          break;
        }
        const input = step.value;
        const index = nextIndex++;
        running.set(
          index,
          runOne(index, input, batchSignal, run).then((entry) => {
            settled.push(entry);
            wake?.();
            return entry;
          }),
        );
      }
      if (running.size === 0) {
        // Only an abort leaves inputs unread with nothing in flight. Each one is reported as
        // ABORTED without starting it, so every input still yields exactly one entry. Reading
        // stays paced by the consumer, which can stop iterating at any time.
        while (!exhausted) {
          const step = readNext(iterator);
          if (step.done === true) {
            break;
          }
          const input = step.value;
          yield Object.freeze({
            index: nextIndex++,
            input,
            result: batchFailure(input, ABORTED_ERROR),
          });
        }
        return;
      }
      let entry = settled.shift();
      while (entry === undefined) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
        entry = settled.shift();
      }
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
