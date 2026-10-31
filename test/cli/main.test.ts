import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { EXIT_INTERRUPTED, EXIT_USAGE, HELP, runCli } from "../../src/cli/main.js";
import type { DetectInput, DetectResult } from "../../src/contracts/detect.js";
import type { QueryInput, QueryResult } from "../../src/contracts/query.js";
import {
  GAME_ALIASES,
  GAME_IDS,
  GAME_REGISTRY,
  isGameAlias,
} from "../../src/contracts/registry.js";

const ABORTED_RESULT: QueryResult = {
  ok: false,
  game: "rust",
  error: { code: "ABORTED", message: "The query was cancelled." },
  durationMs: 1,
  sources: [],
  warnings: [],
};

const TIMEOUT_RESULT: QueryResult = {
  ...ABORTED_RESULT,
  error: { code: "TIMEOUT", message: "The query timed out." },
};

const NOT_DETECTED: DetectResult = {
  ok: false,
  error: { code: "NOT_DETECTED", message: "No supported game answered at this host." },
  probes: [],
  durationMs: 1,
};

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly query: ReturnType<typeof vi.fn<(input: QueryInput) => Promise<QueryResult>>>;
}

async function run(
  args: readonly string[],
  options: {
    readonly result?: QueryResult;
    readonly controller?: AbortController;
    readonly onQuery?: () => void;
  } = {},
): Promise<Run> {
  let stdout = "";
  let stderr = "";
  const query = vi.fn((_input: QueryInput): Promise<QueryResult> => {
    options.onQuery?.();
    return Promise.resolve(options.result ?? TIMEOUT_RESULT);
  });
  const code = await runCli(args, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    signal: (options.controller ?? new AbortController()).signal,
    query,
    detect: (_input: DetectInput): Promise<DetectResult> => Promise.resolve(NOT_DETECTED),
  });
  return { code, stdout, stderr, query };
}

describe("queryhost command runner", (): void => {
  it("exits 2 with help on stderr and no query for a usage error", async (): Promise<void> => {
    const result = await run(["a2s", "play.example.com"]);

    expect(result.code).toBe(EXIT_USAGE);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("a2s requires the server's A2S query port");
    expect(result.stderr).toContain(HELP);
    expect(result.query).not.toHaveBeenCalled();
  });

  it("queries generic A2S with --query-port as its destination port", async (): Promise<void> => {
    const result = await run(["a2s", "play.example.com", "--query-port", "27015"]);

    expect(result.code).toBe(1);
    expect(result.query).toHaveBeenCalledWith(
      expect.objectContaining({ game: "a2s", host: "play.example.com", port: 27_015 }),
    );
    expect(result.query.mock.calls[0]?.[0]).not.toHaveProperty("queryPort");
  });

  it("prints help on stdout and exits 0", async (): Promise<void> => {
    const result = await run(["-h"]);

    expect(result).toMatchObject({ code: 0, stdout: HELP, stderr: "" });
  });

  it("prints indented JSON by default and single-line JSON with --compact", async (): Promise<void> => {
    const pretty = await run(["rust", "play.example.com"]);
    const compact = await run(["rust", "play.example.com", "--compact"]);

    expect(pretty.stdout).toBe(`${JSON.stringify(TIMEOUT_RESULT, null, 2)}\n`);
    expect(compact.stdout).toBe(`${JSON.stringify(TIMEOUT_RESULT)}\n`);
    expect(compact.stdout.trimEnd()).not.toContain("\n");
    expect(compact.code).toBe(1);
  });

  it("exits 0 for a successful query", async (): Promise<void> => {
    const success: QueryResult = {
      ok: true,
      game: "rust",
      server: { queryRttMs: 1 },
      data: {
        protocol: 17,
        game: "Rust",
        folder: "rust",
        bots: 0,
        serverType: "dedicated",
        environment: "linux",
        vac: true,
        appId: 252_490,
      },
      sources: [],
      warnings: [],
      partial: false,
      durationMs: 1,
    } as QueryResult;

    expect((await run(["rust", "play.example.com"], { result: success })).code).toBe(0);
  });

  it("exits 1 for a failed detection", async (): Promise<void> => {
    const result = await run(["auto", "play.example.com"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual(NOT_DETECTED);
  });

  it("exits 130 when interrupted during the query", async (): Promise<void> => {
    const controller = new AbortController();
    const result = await run(["rust", "play.example.com"], {
      controller,
      result: ABORTED_RESULT,
      onQuery: () => {
        controller.abort();
      },
    });

    expect(result.code).toBe(EXIT_INTERRUPTED);
    expect(result.query.mock.calls[0]?.[0].signal).toBe(controller.signal);
    expect(JSON.parse(result.stdout)).toEqual(ABORTED_RESULT);
  });

  it("lists every registry game with its name and aliases", async (): Promise<void> => {
    const result = await run(["--list-games", "--compact"]);

    expect(result.code).toBe(0);
    expect(result.stdout.trimEnd()).not.toContain("\n");
    const expected = GAME_IDS.map((id) => ({
      id,
      name: GAME_REGISTRY[id].name,
      aliases: Object.keys(GAME_ALIASES).filter(
        (alias) => isGameAlias(alias) && GAME_ALIASES[alias] === id,
      ),
    }));
    expect(JSON.parse(result.stdout)).toEqual(expected);
    expect(expected.find(({ id }) => id === "team-fortress-2")?.aliases).toEqual([
      "tf2",
      "teamfortress2",
    ]);
  });
});

// `npm run verify` builds before testing; a bare `vitest` run without `dist/` skips these.
const BUILT_CLI = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));

describe.skipIf(!existsSync(BUILT_CLI))("built queryhost executable", (): void => {
  it("exits 2 and writes help to stderr for a usage error", (): void => {
    const child = spawnSync(process.execPath, [BUILT_CLI, "a2s", "play.example.com"], {
      encoding: "utf8",
    });

    expect(child.status).toBe(EXIT_USAGE);
    expect(child.stdout).toBe("");
    expect(child.stderr).toContain("Usage:");
  });

  it("prints the game list on stdout", (): void => {
    const child = spawnSync(process.execPath, [BUILT_CLI, "--list-games", "--compact"], {
      encoding: "utf8",
    });

    expect(child.status).toBe(0);
    expect(child.stderr).toBe("");
    expect(JSON.parse(child.stdout)).toHaveLength(GAME_IDS.length);
  });
});
