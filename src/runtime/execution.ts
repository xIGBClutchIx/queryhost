/** Bounded lifecycle and error-normalization primitives shared by all future transports. */

import type { QueryError, QuerySourceName } from "../contracts/shared.js";

const ABORTED_MESSAGE = "The query was cancelled.";
const INTERNAL_ERROR_MESSAGE = "The query could not be completed.";
const TIMEOUT_MESSAGE = "The query timed out.";
const DEFAULT_MAX_OUTBOUND_ATTEMPTS = 16;

type Cleanup = () => void;
type ExecutionErrorCode = "ABORTED" | "INTERNAL_ERROR" | "TIMEOUT";
type ExecutionState = "active" | "aborted" | "closed" | "timeout";

interface OutboundAttemptBudget {
  remaining: number;
}

/** Raised internally when one query exhausts its shared outbound-work allowance. */
export class OutboundAttemptLimitError extends Error {
  public override readonly name = "OutboundAttemptLimitError";
}

/**
 * One cancellable deadline scope.
 *
 * A root scope owns the query deadline. Child scopes may shorten that deadline for one source but
 * can never outlive their parent.
 */
export interface ExecutionScope {
  /** Aborts on caller cancellation, this scope's deadline, or parent termination. */
  readonly signal: AbortSignal;
  /** Absolute monotonic deadline measured against `performance.now()`. */
  readonly deadlineMs: number;
  /** Remaining active budget; zero after every form of termination. */
  readonly remainingMs: number;
  /** Stable timeout/cancellation error, or `undefined` while active and after a normal close. */
  getError(): QueryError | undefined;
  /**
   * Registers resource cleanup and returns an unregister function.
   * Cleanup runs once in reverse registration order on every termination path.
   */
  addCleanup(cleanup: Cleanup): Cleanup;
  /** Creates a child budget capped by this scope's deadline. */
  createOperation(timeoutMs: number, source?: QuerySourceName): ExecutionScope;
  /** Consumes shared per-query capacity before starting one or more outbound operations. */
  consumeOutboundAttempts(count?: number): void;
  /** Completes the scope normally while still cancelling unfinished child work. */
  close(): void;
}

/** Inputs used to create a root execution scope. */
export interface ExecutionOptions {
  /** Positive global deadline duration in milliseconds. */
  readonly timeoutMs: number;
  /** Optional caller-owned cancellation signal. */
  readonly signal?: AbortSignal;
  /** Internal root-wide cap shared by DNS, sockets, retries, and optional sources. */
  readonly maxOutboundAttempts?: number;
}

/** Internal task outcome with exceptions reduced to stable public errors. */
export type ExecutionOutcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: QueryError };

/** Asynchronous work performed inside one root execution scope. */
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

function assertOutboundAttempts(maxOutboundAttempts: number): void {
  if (!Number.isSafeInteger(maxOutboundAttempts) || maxOutboundAttempts <= 0) {
    throw new RangeError("The outbound attempt limit must be a positive safe integer.");
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
  readonly #outboundAttempts: OutboundAttemptBudget;
  #detachParent: Cleanup | undefined;
  #state: ExecutionState = "active";

  public readonly deadlineMs: number;

  public constructor(
    timeoutMs: number,
    outboundAttempts: OutboundAttemptBudget,
    parent?: ExecutionScope,
    source?: QuerySourceName,
  ) {
    assertTimeout(timeoutMs);

    this.#source = source;
    this.#startedMs = performance.now();
    this.#outboundAttempts = outboundAttempts;

    const requestedDeadline = this.#startedMs + timeoutMs;
    // An operation budget can only make a parent deadline stricter, never extend it.
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

    // A child sharing its parent's deadline needs no duplicate timer; parent abort propagation wins.
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
    return new DefaultExecutionScope(timeoutMs, this.#outboundAttempts, this, source);
  }

  public consumeOutboundAttempts(count = 1): void {
    if (!Number.isSafeInteger(count) || count <= 0) {
      throw new RangeError("The outbound attempt count must be a positive safe integer.");
    }
    if (count > this.#outboundAttempts.remaining) {
      throw new OutboundAttemptLimitError("The query exceeded its outbound attempt limit.");
    }
    this.#outboundAttempts.remaining -= count;
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

    // LIFO mirrors nested resource acquisition and still runs every callback if one is faulty.
    const cleanups = [...this.#cleanups].reverse();
    this.#cleanups.clear();
    for (const cleanup of cleanups) {
      runCleanup(cleanup);
    }
  }
}

/** Creates the root scope for one query and composes an optional caller signal into it. */
export function createExecutionContext(options: ExecutionOptions): ExecutionScope {
  const maxOutboundAttempts = options.maxOutboundAttempts ?? DEFAULT_MAX_OUTBOUND_ATTEMPTS;
  assertOutboundAttempts(maxOutboundAttempts);
  const context = new DefaultExecutionScope(options.timeoutMs, { remaining: maxOutboundAttempts });

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

/**
 * Executes a task within a hard deadline and converts all rejection details to stable errors.
 *
 * The termination race makes the wrapper settle even when faulty work ignores its abort signal.
 * Registered cleanup always runs before the returned promise settles.
 */
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

    // Attach both handlers immediately so a task that loses the deadline race cannot later produce
    // an unhandled rejection or leak its implementation error.
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
