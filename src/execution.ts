import type { QueryError, QuerySourceName } from "./shared.js";

const ABORTED_MESSAGE = "The query was cancelled.";
const INTERNAL_ERROR_MESSAGE = "The query could not be completed.";
const TIMEOUT_MESSAGE = "The query timed out.";

type Cleanup = () => void;
type ExecutionErrorCode = "ABORTED" | "INTERNAL_ERROR" | "TIMEOUT";
type ExecutionState = "active" | "aborted" | "closed" | "timeout";

export interface ExecutionScope {
  readonly signal: AbortSignal;
  readonly deadlineMs: number;
  readonly remainingMs: number;
  getError(): QueryError | undefined;
  addCleanup(cleanup: Cleanup): Cleanup;
  createOperation(timeoutMs: number, source?: QuerySourceName): ExecutionScope;
  close(): void;
}

export interface ExecutionOptions {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export type ExecutionOutcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: QueryError };

export type ExecutionTask<T> = (context: ExecutionScope) => Promise<T>;

type TaskCompletion<T> =
  | { readonly kind: "success"; readonly value: T }
  | { readonly kind: "failure" }
  | { readonly kind: "terminated" };

function assertTimeout(timeoutMs: number): void {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("The timeout must be a positive safe integer.");
  }
}

function createError(code: ExecutionErrorCode, source?: QuerySourceName): QueryError {
  const message =
    code === "ABORTED"
      ? ABORTED_MESSAGE
      : code === "TIMEOUT"
        ? TIMEOUT_MESSAGE
        : INTERNAL_ERROR_MESSAGE;

  return source === undefined ? { code, message } : { code, message, source };
}

function runCleanup(cleanup: Cleanup): void {
  try {
    cleanup();
  } catch {
    // Cleanup is best-effort, but one faulty resource must not prevent the rest from closing.
  }
}

function waitForTermination(context: ExecutionScope): Promise<TaskCompletion<never>> {
  if (context.signal.aborted) {
    return Promise.resolve({ kind: "terminated" });
  }

  return new Promise((resolve) => {
    const handleAbort = (): void => {
      resolve({ kind: "terminated" });
    };
    context.signal.addEventListener("abort", handleAbort, { once: true });
    context.addCleanup(() => {
      context.signal.removeEventListener("abort", handleAbort);
    });
  });
}

class DefaultExecutionScope implements ExecutionScope {
  readonly #controller = new AbortController();
  readonly #cleanups = new Set<Cleanup>();
  readonly #source: QuerySourceName | undefined;
  readonly #startedMs: number;
  readonly #timeout: ReturnType<typeof setTimeout> | undefined;
  #detachParent: Cleanup | undefined;
  #state: ExecutionState = "active";

  public readonly deadlineMs: number;

  public constructor(timeoutMs: number, parent?: ExecutionScope, source?: QuerySourceName) {
    assertTimeout(timeoutMs);

    this.#source = source;
    this.#startedMs = performance.now();

    const requestedDeadline = this.#startedMs + timeoutMs;
    this.deadlineMs =
      parent === undefined ? requestedDeadline : Math.min(requestedDeadline, parent.deadlineMs);

    if (parent?.signal.aborted === true) {
      this.#finish(parent.getError()?.code === "TIMEOUT" ? "timeout" : "aborted");
      return;
    }

    if (parent !== undefined) {
      const handleParentAbort = (): void => {
        this.#finish(parent.getError()?.code === "TIMEOUT" ? "timeout" : "aborted");
      };
      parent.signal.addEventListener("abort", handleParentAbort, { once: true });
      this.#detachParent = (): void => {
        parent.signal.removeEventListener("abort", handleParentAbort);
      };
    }

    const remainingMs = this.deadlineMs - performance.now();
    if (remainingMs <= 0) {
      this.#finish("timeout");
      return;
    }

    if (parent === undefined || this.deadlineMs < parent.deadlineMs) {
      this.#timeout = setTimeout(() => {
        this.#finish("timeout");
      }, remainingMs);
    }
  }

  public get signal(): AbortSignal {
    return this.#controller.signal;
  }

  public get remainingMs(): number {
    return this.#state === "active" ? Math.max(0, this.deadlineMs - performance.now()) : 0;
  }

  public getError(): QueryError | undefined {
    if (this.#state === "aborted") {
      return createError("ABORTED", this.#source);
    }
    if (this.#state === "timeout") {
      return createError("TIMEOUT", this.#source);
    }
    return undefined;
  }

  public addCleanup(cleanup: Cleanup): Cleanup {
    if (this.#state !== "active") {
      runCleanup(cleanup);
      return (): void => undefined;
    }

    this.#cleanups.add(cleanup);
    return (): void => {
      this.#cleanups.delete(cleanup);
    };
  }

  public createOperation(timeoutMs: number, source?: QuerySourceName): ExecutionScope {
    return new DefaultExecutionScope(timeoutMs, this, source);
  }

  public abort(): void {
    this.#finish("aborted");
  }

  public close(): void {
    this.#finish("closed");
  }

  #finish(state: Exclude<ExecutionState, "active">): void {
    if (this.#state !== "active") {
      return;
    }

    this.#state = state;
    if (this.#timeout !== undefined) {
      clearTimeout(this.#timeout);
    }
    this.#detachParent?.();
    this.#detachParent = undefined;
    this.#controller.abort();

    const cleanups = [...this.#cleanups].reverse();
    this.#cleanups.clear();
    for (const cleanup of cleanups) {
      runCleanup(cleanup);
    }
  }
}

export function createExecutionContext(options: ExecutionOptions): ExecutionScope {
  const context = new DefaultExecutionScope(options.timeoutMs);

  if (options.signal?.aborted === true) {
    context.abort();
    return context;
  }

  if (options.signal !== undefined) {
    const handleAbort = (): void => {
      context.abort();
    };
    options.signal.addEventListener("abort", handleAbort, { once: true });
    context.addCleanup(() => {
      options.signal?.removeEventListener("abort", handleAbort);
    });
  }

  return context;
}

export async function executeWithDeadline<T>(
  options: ExecutionOptions,
  task: ExecutionTask<T>,
): Promise<ExecutionOutcome<T>> {
  const context = createExecutionContext(options);

  try {
    const initialError = context.getError();
    if (initialError !== undefined) {
      return { ok: false, error: initialError };
    }

    const taskCompletion: Promise<TaskCompletion<T>> = task(context).then(
      (value) => ({ kind: "success", value }),
      () => ({ kind: "failure" }),
    );
    const completion = await Promise.race([taskCompletion, waitForTermination(context)]);
    const completionError = context.getError();

    if (completion.kind === "success" && completionError === undefined) {
      return { ok: true, value: completion.value };
    }
    if (completionError !== undefined) {
      return { ok: false, error: completionError };
    }
    return { ok: false, error: createError("INTERNAL_ERROR") };
  } catch {
    return {
      ok: false,
      error: context.getError() ?? createError("INTERNAL_ERROR"),
    };
  } finally {
    context.close();
  }
}
