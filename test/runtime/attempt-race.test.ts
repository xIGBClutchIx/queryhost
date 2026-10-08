import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ATTEMPT_STAGGER_MS, raceAttempts } from "../../src/runtime/attempt-race.js";
import { createExecutionContext, type ExecutionScope } from "../../src/runtime/execution.js";

class TerminatedError extends Error {}

function hangUntilAborted(operation: ExecutionScope): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    operation.signal.addEventListener(
      "abort",
      () => {
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

function race(
  scope: ExecutionScope,
  candidates: readonly string[],
  attempt: (candidate: string, operation: ExecutionScope) => Promise<string>,
): Promise<{ readonly candidate: string; readonly value: string }> {
  return raceAttempts(
    {
      scope,
      candidates,
      operationTimeoutMs: 2_000,
      source: "a2s-info",
      terminated: () => new TerminatedError("terminated"),
      empty: () => new Error("empty"),
    },
    attempt,
  );
}

describe("staggered attempt race", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not start later candidates when the first succeeds", async () => {
    const scope = createExecutionContext({ timeoutMs: 5_000 });
    const started: string[] = [];

    const result = await race(scope, ["a", "b"], (candidate) => {
      started.push(candidate);
      return Promise.resolve(`from ${candidate}`);
    });
    await vi.advanceTimersByTimeAsync(ATTEMPT_STAGGER_MS * 4);

    expect(result).toEqual({ candidate: "a", value: "from a" });
    expect(started).toEqual(["a"]);
    expect(vi.getTimerCount()).toBe(1);
    scope.close();
  });

  it("starts the next candidate after the stagger and cancels the loser", async () => {
    const scope = createExecutionContext({ timeoutMs: 5_000 });
    const started: string[] = [];
    let first: ExecutionScope | undefined;

    const pending = race(scope, ["dead", "live"], (candidate, operation) => {
      started.push(candidate);
      if (candidate === "dead") {
        first = operation;
        return hangUntilAborted(operation);
      }
      return Promise.resolve("ok");
    });

    await vi.advanceTimersByTimeAsync(ATTEMPT_STAGGER_MS - 1);
    expect(started).toEqual(["dead"]);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual({ candidate: "live", value: "ok" });
    expect(first?.signal.aborted).toBe(true);
    scope.close();
  });

  it("starts the next candidate immediately when an attempt fails", async () => {
    const scope = createExecutionContext({ timeoutMs: 5_000 });
    const started: string[] = [];

    const result = await race(scope, ["refused", "live"], (candidate) => {
      started.push(candidate);
      return candidate === "refused" ? Promise.reject(new Error("refused")) : Promise.resolve("ok");
    });

    expect(result.candidate).toBe("live");
    expect(started).toEqual(["refused", "live"]);
    scope.close();
  });

  it("raises the last candidate's error once every attempt fails", async () => {
    const scope = createExecutionContext({ timeoutMs: 5_000 });

    const pending = race(scope, ["slow", "fast"], (candidate, operation) => {
      if (candidate === "fast") {
        return Promise.reject(new Error("fast failed"));
      }
      return new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("slow failed"));
        }, 1_000);
        operation.signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    });
    const settled = expect(pending).rejects.toThrow("fast failed");
    await vi.advanceTimersByTimeAsync(1_000);

    await settled;
    scope.close();
  });

  it("raises the termination error and cancels every attempt when the scope aborts", async () => {
    const controller = new AbortController();
    const scope = createExecutionContext({ timeoutMs: 5_000, signal: controller.signal });
    const operations: ExecutionScope[] = [];

    const pending = race(scope, ["a", "b"], (_candidate, operation) => {
      operations.push(operation);
      return hangUntilAborted(operation);
    });
    await vi.advanceTimersByTimeAsync(ATTEMPT_STAGGER_MS);
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(TerminatedError);
    expect(operations).toHaveLength(2);
    expect(operations.every((operation) => operation.signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an empty candidate list and an already terminated scope", async () => {
    const scope = createExecutionContext({ timeoutMs: 5_000 });
    const attempt = vi.fn(() => Promise.resolve("ok"));

    await expect(race(scope, [], attempt)).rejects.toThrow("empty");
    scope.close();
    await expect(race(scope, ["a"], attempt)).rejects.toBeInstanceOf(TerminatedError);
    expect(attempt).not.toHaveBeenCalled();
  });
});
