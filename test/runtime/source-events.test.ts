import { afterEach, describe, expect, it, vi } from "vitest";

import type { QuerySource, QuerySourceEvent } from "../../src/contracts/shared.js";
import type { A2sExchangeDependencies } from "../../src/protocols/a2s/network.js";
import { queryWithDependencies } from "../../src/runtime/client.js";
import type { UdpCollectionResult } from "../../src/transports/udp.js";
import { dependencies, fixtureA2s } from "../helpers/a2s-profile.js";

function recorder(): {
  readonly events: QuerySourceEvent[];
  readonly onSource: (event: QuerySourceEvent) => void;
} {
  const events: QuerySourceEvent[] = [];
  return { events, onSource: (event): void => void events.push(event) };
}

function completedReports(events: readonly QuerySourceEvent[]): QuerySource[] {
  return events.flatMap((event) => (event.type === "completed" ? [event.report] : []));
}

/** Simulates an untyped JavaScript caller that passes a non-function callback. */
function untypedCallback(value: string | object): (event: QuerySourceEvent) => void {
  return value as (event: QuerySourceEvent) => void;
}

afterEach((): void => {
  vi.useRealTimers();
});

describe("query source progress", (): void => {
  it("reports each source starting before it completes, ending with the result's sources", async (): Promise<void> => {
    const { events, onSource } = recorder();

    const result = await queryWithDependencies(
      { game: "rust", host: "play.example.com", onSource },
      dependencies(await fixtureA2s("rust")),
    );

    expect(result.ok).toBe(true);
    expect(events[0]).toEqual({ type: "started", source: "a2s-info" });
    for (const report of result.sources) {
      const started = events.findIndex(
        (event) => event.type === "started" && event.source === report.source,
      );
      const completed = events.findIndex(
        (event) => event.type === "completed" && event.report.source === report.source,
      );
      expect(started).toBeGreaterThanOrEqual(0);
      expect(completed).toBeGreaterThan(started);
    }
    expect(completedReports(events)).toEqual(expect.arrayContaining([...result.sources]));
    expect(completedReports(events)).toHaveLength(result.sources.length);
  });

  it("completes skipped sources without a start", async (): Promise<void> => {
    const { events, onSource } = recorder();

    const result = await queryWithDependencies(
      { game: "rust", host: "play.example.com", mode: "summary", onSource },
      dependencies(await fixtureA2s("rust")),
    );

    expect(result.sources).toContainEqual({ source: "a2s-player", status: "not-requested" });
    expect(events).toContainEqual({
      type: "completed",
      report: { source: "a2s-player", status: "not-requested" },
    });
    expect(events).not.toContainEqual({ type: "started", source: "a2s-player" });
  });

  it("completes a source a timeout cut short and reports nothing after the query resolves", async (): Promise<void> => {
    vi.useFakeTimers();
    const { events, onSource } = recorder();
    let release: (() => void) | undefined;
    const a2s: A2sExchangeDependencies = {
      collect(options): Promise<UdpCollectionResult> {
        return new Promise((resolve) => {
          release = (): void => {
            resolve({ datagrams: [], rttMs: 1, address: options.address, port: 28_017 });
          };
        });
      },
    };
    const pending = queryWithDependencies(
      { game: "rust", host: "play.example.com", timeoutMs: 100, onSource },
      dependencies(a2s),
    );

    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    const settled = events.length;
    release?.();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(result).toMatchObject({ ok: false, error: { code: "TIMEOUT" } });
    expect(events).toEqual([
      { type: "started", source: "a2s-info" },
      { type: "completed", report: { source: "a2s-info", status: "timeout" } },
    ]);
    expect(events).toHaveLength(settled);
  });

  it("ignores a callback that throws", async (): Promise<void> => {
    const onSource = vi.fn<(event: QuerySourceEvent) => void>(() => {
      throw new Error("dashboard bug");
    });

    const result = await queryWithDependencies(
      { game: "rust", host: "play.example.com", onSource },
      dependencies(await fixtureA2s("rust")),
    );

    expect(result.ok).toBe(true);
    expect(onSource).toHaveBeenCalled();
  });

  it("rejects a non-function callback as INVALID_INPUT", async (): Promise<void> => {
    const onSource = untypedCallback("log");

    const result = await queryWithDependencies(
      { game: "rust", host: "play.example.com", onSource },
      dependencies(await fixtureA2s("rust")),
    );

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" }, sources: [] });
  });
});
