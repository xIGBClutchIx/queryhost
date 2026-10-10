import { describe, expect, it, vi } from "vitest";

import type {
  GameInputId,
  QueryInput,
  QueryManyEntry,
  QueryResult,
} from "../../src/contracts/query.js";
import { queryManyWith, type QueryRunner } from "../../src/runtime/batch.js";
import { queryMany } from "../../src/runtime/client.js";

type RustInput = QueryInput<"rust">;
type RustResult = QueryResult<"rust">;

interface Pending {
  readonly input: RustInput;
  readonly resolve: (result: RustResult) => void;
  readonly reject: (error: Error) => void;
}

function failed(code: "ABORTED" | "TIMEOUT" = "TIMEOUT"): RustResult {
  return {
    ok: false,
    game: "rust",
    error: { code, message: code === "ABORTED" ? "The query was cancelled." : "Timed out." },
    durationMs: 1,
    sources: [],
    warnings: [],
  };
}

/** A runner whose queries settle only when a test says so, resolving ABORTED on cancellation. */
function controlledRunner(): { readonly run: QueryRunner<"rust">; readonly pending: Pending[] } {
  const pending: Pending[] = [];
  const run: QueryRunner<"rust"> = (input) =>
    new Promise<RustResult>((resolve, reject) => {
      input.signal?.addEventListener(
        "abort",
        (): void => {
          resolve(failed("ABORTED"));
        },
        { once: true },
      );
      pending.push({ input, resolve, reject });
    });
  return { run, pending };
}

function inputs(count: number): RustInput[] {
  return Array.from({ length: count }, (_, index) => ({
    game: "rust",
    host: `play${index}.example.com`,
  }));
}

/** Simulates untyped JavaScript callers that bypass the declared batch types. */
function untypedInputs(value: object | null): Iterable<RustInput> {
  return value as Iterable<RustInput>;
}

function untypedSignal(value: object): AbortSignal {
  return value as AbortSignal;
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve();
  }
}

function pendingAt(pending: readonly Pending[], index: number): Pending {
  const entry = pending[index];
  if (entry === undefined) {
    throw new Error(`No query was started at position ${index}.`);
  }
  return entry;
}

async function collect<G extends GameInputId>(
  batch: AsyncIterable<QueryManyEntry<G>>,
): Promise<QueryManyEntry<G>[]> {
  const entries: QueryManyEntry<G>[] = [];
  for await (const entry of batch) {
    entries.push(entry);
  }
  return entries;
}

describe("queryMany batching", (): void => {
  it("yields every input once, in completion order, with its index and original input", async (): Promise<void> => {
    const { run, pending } = controlledRunner();
    const servers = inputs(3);
    const iterator = queryManyWith(servers, undefined, run)[Symbol.asyncIterator]();

    const first = iterator.next();
    await flush();
    expect(pending).toHaveLength(3);
    pendingAt(pending, 2).resolve(failed());
    pendingAt(pending, 0).resolve(failed());
    pendingAt(pending, 1).resolve(failed());

    const indexes = [(await first).value?.index];
    for await (const entry of { [Symbol.asyncIterator]: () => iterator }) {
      indexes.push(entry.index);
    }
    expect(indexes).toEqual([2, 0, 1]);
  });

  it("returns the caller's own input, not the signal-carrying copy it runs", async (): Promise<void> => {
    const servers = inputs(1);
    const run = vi.fn<QueryRunner<"rust">>(() => Promise.resolve(failed()));

    const [entry] = await collect(queryManyWith(servers, undefined, run));

    expect(entry?.input).toBe(servers[0]);
    expect(entry?.result).toEqual(failed());
    expect(run.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("never runs more than the concurrency limit, counting results the consumer has not read", async (): Promise<void> => {
    const { run, pending } = controlledRunner();
    const iterator = queryManyWith(inputs(5), { concurrency: 2 }, run)[Symbol.asyncIterator]();

    const first = iterator.next();
    await flush();
    expect(pending).toHaveLength(2);

    pendingAt(pending, 0).resolve(failed());
    pendingAt(pending, 1).resolve(failed());
    await flush();
    // Both slots hold settled results; the next input waits until the consumer reads one.
    expect(pending).toHaveLength(2);

    expect((await first).value?.index).toBe(0);
    await iterator.next();
    await flush();
    expect(pending).toHaveLength(3);
    await iterator.return(undefined);
  });

  it("defaults to eight concurrent queries", async (): Promise<void> => {
    const { run, pending } = controlledRunner();
    const iterator = queryManyWith(inputs(20), undefined, run)[Symbol.asyncIterator]();

    const first = iterator.next();
    await flush();
    expect(pending).toHaveLength(8);

    pendingAt(pending, 0).resolve(failed());
    await first;
    await iterator.return(undefined);
  });

  it("starts nothing until iteration begins and reads inputs lazily", async (): Promise<void> => {
    const run = vi.fn<QueryRunner<"rust">>(() => Promise.resolve(failed()));
    const read = vi.fn<() => void>();
    function* servers(): Generator<RustInput> {
      for (const input of inputs(4)) {
        read();
        yield input;
      }
    }

    const batch = queryManyWith(servers(), { concurrency: 1 }, run);
    await flush();
    expect(run).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();

    const iterator = batch[Symbol.asyncIterator]();
    await iterator.next();
    expect(read).toHaveBeenCalledTimes(1);
    await iterator.return(undefined);
  });

  it("turns a rejected query into an INTERNAL_ERROR entry instead of failing the batch", async (): Promise<void> => {
    let calls = 0;
    const run: QueryRunner<"rust"> = () => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("boom")) : Promise.resolve(failed());
    };

    const entries = await collect(queryManyWith(inputs(2), undefined, run));

    expect(entries.map(({ result }) => (result.ok ? "ok" : result.error.code))).toEqual([
      "INTERNAL_ERROR",
      "TIMEOUT",
    ]);
    expect(entries[0]?.result).toEqual({
      ok: false,
      game: "rust",
      error: { code: "INTERNAL_ERROR", message: "The query could not be completed." },
      durationMs: 0,
      sources: [],
      warnings: [],
    });
  });

  it("stops starting inputs when the batch signal aborts and resolves in-flight work as ABORTED", async (): Promise<void> => {
    const { run, pending } = controlledRunner();
    const controller = new AbortController();
    const iterator = queryManyWith(inputs(5), { concurrency: 2, signal: controller.signal }, run)[
      Symbol.asyncIterator
    ]();

    const first = iterator.next();
    await flush();
    controller.abort();

    const entries = [(await first).value];
    for await (const entry of { [Symbol.asyncIterator]: () => iterator }) {
      entries.push(entry);
    }
    expect(pending).toHaveLength(2);
    expect(
      entries.map((entry) => (entry?.result.ok === false ? entry.result.error.code : "ok")),
    ).toEqual(["ABORTED", "ABORTED"]);
  });

  it("starts nothing when the batch signal is already aborted", async (): Promise<void> => {
    const run = vi.fn<QueryRunner<"rust">>(() => Promise.resolve(failed()));

    const entries = await collect(queryManyWith(inputs(3), { signal: AbortSignal.abort() }, run));

    expect(entries).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps each input's own signal alongside the batch signal", async (): Promise<void> => {
    const { run, pending } = controlledRunner();
    const own = new AbortController();
    const servers: RustInput[] = [{ game: "rust", host: "play.example.com", signal: own.signal }];
    const iterator = queryManyWith(servers, undefined, run)[Symbol.asyncIterator]();

    const first = iterator.next();
    await flush();
    own.abort();

    expect((await first).value?.result).toEqual(failed("ABORTED"));
    expect(pendingAt(pending, 0).input.signal).not.toBe(own.signal);
  });

  it("cancels in-flight queries, waits for them, and closes the input iterator when the consumer stops early", async (): Promise<void> => {
    const { run, pending } = controlledRunner();
    const closed = vi.fn<() => void>();
    function* servers(): Generator<RustInput> {
      try {
        yield* inputs(10);
      } finally {
        closed();
      }
    }
    const iterator = queryManyWith(servers(), { concurrency: 3 }, run)[Symbol.asyncIterator]();

    const first = iterator.next();
    await flush();
    pendingAt(pending, 1).resolve(failed());
    expect((await first).value?.index).toBe(1);

    await iterator.return(undefined);

    expect(pending).toHaveLength(3);
    expect(pending.every(({ input }) => input.signal?.aborted === true)).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("propagates an exception thrown by the caller's input iterator after in-flight work ends", async (): Promise<void> => {
    const { run, pending } = controlledRunner();
    function* servers(): Generator<RustInput> {
      yield* inputs(1);
      throw new Error("bad input source");
    }

    await expect(collect(queryManyWith(servers(), undefined, run))).rejects.toThrow(
      "bad input source",
    );
    expect(pendingAt(pending, 0).input.signal?.aborted).toBe(true);
  });

  it.each([0, 65, 1.5, Number.NaN])("rejects concurrency %s synchronously", (concurrency): void => {
    expect(() => queryMany(inputs(1), { concurrency })).toThrow(RangeError);
  });

  it("rejects a non-iterable input list and a non-AbortSignal signal synchronously", (): void => {
    expect(() => queryMany(untypedInputs(null))).toThrow(TypeError);
    expect(() => queryMany(untypedInputs({}))).toThrow(TypeError);
    expect(() => queryMany(inputs(1), { signal: untypedSignal({}) })).toThrow(TypeError);
  });

  it("reports invalid individual inputs as INVALID_INPUT entries through the real client", async (): Promise<void> => {
    const servers: RustInput[] = [{ game: "rust", host: "play.example.com", timeoutMs: 0 }];

    const [entry] = await collect(queryMany(servers));

    expect(entry?.result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });
});
