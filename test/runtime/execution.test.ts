import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createExecutionContext,
  executeWithDeadline,
  OutboundAttemptLimitError,
} from "../../src/runtime/execution.js";

async function rejectOnAbort(signal: AbortSignal): Promise<never> {
  await new Promise<void>((resolve) => {
    signal.addEventListener(
      "abort",
      () => {
        resolve();
      },
      { once: true },
    );
  });
  throw new Error("transport stopped");
}

describe("query execution context", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enforces the global deadline deterministically", async () => {
    const execution = executeWithDeadline({ timeoutMs: 1_000 }, async (context) => {
      await rejectOnAbort(context.signal);
      return "unreachable";
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);

    await expect(execution).resolves.toEqual({
      ok: false,
      error: { code: "TIMEOUT", message: "The query timed out." },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles at the deadline even when work ignores cancellation", async () => {
    const execution = executeWithDeadline({ timeoutMs: 500 }, () => new Promise(() => undefined));

    await vi.advanceTimersByTimeAsync(500);

    await expect(execution).resolves.toEqual({
      ok: false,
      error: { code: "TIMEOUT", message: "The query timed out." },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("limits operations without allowing them to outlive the global deadline", async () => {
    const context = createExecutionContext({ timeoutMs: 1_000 });
    const shortOperation = context.createOperation(250, "a2s-info");
    const longOperation = context.createOperation(2_000, "a2s-rules");

    expect(shortOperation.deadlineMs).toBeLessThan(context.deadlineMs);
    expect(longOperation.deadlineMs).toBe(context.deadlineMs);

    await vi.advanceTimersByTimeAsync(250);
    expect(shortOperation.getError()).toEqual({
      code: "TIMEOUT",
      message: "The query timed out.",
      source: "a2s-info",
    });
    expect(longOperation.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(750);
    expect(context.getError()?.code).toBe("TIMEOUT");
    expect(longOperation.getError()).toEqual({
      code: "TIMEOUT",
      message: "The query timed out.",
      source: "a2s-rules",
    });

    shortOperation.close();
    longOperation.close();
    context.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates caller cancellation and closes registered resources once", () => {
    const caller = new AbortController();
    const context = createExecutionContext({ timeoutMs: 5_000, signal: caller.signal });
    const operation = context.createOperation(1_000, "minecraft-slp");
    const closeResource = vi.fn();

    operation.addCleanup(closeResource);
    caller.abort();

    expect(context.getError()).toEqual({
      code: "ABORTED",
      message: "The query was cancelled.",
    });
    expect(operation.getError()).toEqual({
      code: "ABORTED",
      message: "The query was cancelled.",
      source: "minecraft-slp",
    });
    expect(closeResource).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);

    caller.abort();
    context.close();
    operation.close();
    expect(closeResource).toHaveBeenCalledTimes(1);
  });

  it("maps cancellation through the task boundary without leaking rejection details", async () => {
    const caller = new AbortController();
    const closeResource = vi.fn();
    const execution = executeWithDeadline(
      { timeoutMs: 5_000, signal: caller.signal },
      async (context) => {
        context.addCleanup(closeResource);
        await rejectOnAbort(context.signal);
        return "unreachable";
      },
    );

    caller.abort("private caller reason");

    await expect(execution).resolves.toEqual({
      ok: false,
      error: { code: "ABORTED", message: "The query was cancelled." },
    });
    expect(closeResource).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await execution)).not.toContain("private caller reason");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs every cleanup in reverse order even when one throws", () => {
    const context = createExecutionContext({ timeoutMs: 1_000 });
    const calls: string[] = [];

    context.addCleanup(() => {
      calls.push("first");
    });
    context.addCleanup(() => {
      calls.push("second");
      throw new Error("cleanup detail");
    });
    context.addCleanup(() => {
      calls.push("third");
    });

    context.close();

    expect(calls).toEqual(["third", "second", "first"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not leak internal failure details", async () => {
    const result = await executeWithDeadline({ timeoutMs: 1_000 }, () => {
      throw new Error("socket path and secret implementation detail");
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The query could not be completed.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret implementation detail");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes resources after successful work", async () => {
    const closeResource = vi.fn();

    await expect(
      executeWithDeadline({ timeoutMs: 1_000 }, (context) => {
        context.addCleanup(closeResource);
        return Promise.resolve("complete");
      }),
    ).resolves.toEqual({ ok: true, value: "complete" });
    expect(closeResource).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("immediately cleans resources registered after termination", () => {
    const caller = new AbortController();
    caller.abort();
    const context = createExecutionContext({ timeoutMs: 1_000, signal: caller.signal });
    const closeResource = vi.fn();

    context.addCleanup(closeResource);

    expect(context.remainingMs).toBe(0);
    expect(closeResource).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares one outbound-attempt budget with every child operation", () => {
    const context = createExecutionContext({ timeoutMs: 1_000, maxOutboundAttempts: 3 });
    const operation = context.createOperation(500, "minecraft-slp");

    operation.consumeOutboundAttempts(2);
    context.consumeOutboundAttempts();

    expect(() => {
      operation.consumeOutboundAttempts();
    }).toThrow(OutboundAttemptLimitError);
    operation.close();
    context.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects invalid budgets before allocating timers", () => {
    expect(() => createExecutionContext({ timeoutMs: 0 })).toThrow(RangeError);
    expect(() => createExecutionContext({ timeoutMs: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
    expect(() => createExecutionContext({ timeoutMs: 1_000, maxOutboundAttempts: 0 })).toThrow(
      RangeError,
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
