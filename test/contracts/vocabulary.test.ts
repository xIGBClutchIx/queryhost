import { describe, expect, it } from "vitest";

import {
  type CodeGuidance,
  DETECT_ERROR_CODES,
  DETECT_ERROR_GUIDANCE,
  GAME_CAPABILITIES,
  GAME_IDS,
  GAME_PROTOCOLS,
  GAME_REGISTRY,
  QUERY_ERROR_CODES,
  QUERY_ERROR_GUIDANCE,
  QUERY_SOURCE_LABELS,
  QUERY_SOURCE_NAMES,
  QUERY_SOURCE_STATUSES,
  QUERY_WARNING_CODES,
  QUERY_WARNING_GUIDANCE,
  SUPPORT_LEVELS,
} from "../../src/index.js";

const VOCABULARIES = {
  DETECT_ERROR_CODES,
  GAME_CAPABILITIES,
  GAME_PROTOCOLS,
  QUERY_ERROR_CODES,
  QUERY_SOURCE_NAMES,
  QUERY_SOURCE_STATUSES,
  QUERY_WARNING_CODES,
  SUPPORT_LEVELS,
} as const;

describe("result vocabulary", () => {
  it.each(Object.entries(VOCABULARIES))("%s is frozen, non-empty, and unique", (_, members) => {
    expect(Object.isFrozen(members)).toBe(true);
    expect(members.length).toBeGreaterThan(0);
    expect(new Set(members).size).toBe(members.length);
    for (const member of members) {
      expect(member.length).toBeGreaterThan(0);
    }
  });

  it("lists every value of each union in declaration order", () => {
    expect(SUPPORT_LEVELS).toEqual(["supported", "conditional", "unsupported"]);
    expect(GAME_CAPABILITIES).toEqual([
      "summary",
      "players",
      "rules",
      "mods",
      "plugins",
      "resources",
      "srv",
    ]);
    expect(GAME_PROTOCOLS).toEqual([
      "a2s",
      "a2s-unreal",
      "minecraft-java",
      "minecraft-bedrock",
      "cfx",
      "satisfactory",
      "vintage-story",
      "eco",
      "project-reclaimer",
    ]);
    expect(QUERY_SOURCE_NAMES).toEqual([
      "a2s-info",
      "a2s-player",
      "a2s-rules",
      "minecraft-srv",
      "minecraft-slp",
      "minecraft-legacy-ping",
      "minecraft-query",
      "minecraft-bedrock-raknet",
      "minecraft-bedrock-nethernet",
      "fivem-info",
      "fivem-dynamic",
      "fivem-players",
      "redm-info",
      "redm-dynamic",
      "redm-players",
      "satisfactory-lightweight",
      "satisfactory-health",
      "vintage-story-query",
      "eco-frontpage",
      "project-reclaimer-status",
    ]);
    expect(QUERY_SOURCE_STATUSES).toEqual([
      "ok",
      "timeout",
      "blocked",
      "malformed",
      "unsupported",
      "not-requested",
      "failed",
    ]);
    expect(QUERY_WARNING_CODES).toEqual([
      "PARTIAL_RESULT",
      "PLAYER_LIST_UNAVAILABLE",
      "SOURCE_BLOCKED",
      "SOURCE_FAILED",
      "SOURCE_MALFORMED",
      "SOURCE_TIMEOUT",
    ]);
    expect(QUERY_ERROR_CODES).toEqual([
      "ABORTED",
      "CONNECTION_FAILED",
      "DNS_FAILED",
      "INTERNAL_ERROR",
      "INVALID_INPUT",
      "MALFORMED_RESPONSE",
      "RESPONSE_TOO_LARGE",
      "TARGET_BLOCKED",
      "TIMEOUT",
    ]);
    expect(DETECT_ERROR_CODES).toEqual([
      "ABORTED",
      "DNS_FAILED",
      "INVALID_INPUT",
      "TARGET_BLOCKED",
      "NOT_DETECTED",
    ]);
  });

  it("shares every detection failure code except NOT_DETECTED with query failures", () => {
    const shared: readonly string[] = QUERY_ERROR_CODES;
    expect(DETECT_ERROR_CODES.filter((code) => !shared.includes(code))).toEqual(["NOT_DETECTED"]);
  });

  it("lists only protocols some registered game uses", () => {
    const used = new Set(GAME_IDS.map((game) => GAME_REGISTRY[game].protocol));
    expect([...used].sort()).toEqual([...GAME_PROTOCOLS].sort());
  });
});

describe("query source labels", () => {
  it("labels exactly the query sources, in their order", () => {
    expect(Object.isFrozen(QUERY_SOURCE_LABELS)).toBe(true);
    expect(Object.keys(QUERY_SOURCE_LABELS)).toEqual(QUERY_SOURCE_NAMES);
  });

  it("gives every source a short, trimmed label", () => {
    for (const source of QUERY_SOURCE_NAMES) {
      const label = QUERY_SOURCE_LABELS[source];
      expect(label).toBe(label.trim());
      expect(label.length).toBeGreaterThan(0);
      expect(label.length).toBeLessThanOrEqual(24);
    }
    expect(QUERY_SOURCE_LABELS["eco-frontpage"]).toBe("Front page");
    expect(QUERY_SOURCE_LABELS["project-reclaimer-status"]).toBe("Server browser");
    expect(QUERY_SOURCE_LABELS["minecraft-srv"]).toBe("SRV");
  });
});

const GUIDANCE: readonly (readonly [
  string,
  readonly string[],
  Readonly<Record<string, CodeGuidance>>,
])[] = [
  ["QUERY_ERROR_GUIDANCE", QUERY_ERROR_CODES, QUERY_ERROR_GUIDANCE],
  ["DETECT_ERROR_GUIDANCE", DETECT_ERROR_CODES, DETECT_ERROR_GUIDANCE],
  ["QUERY_WARNING_GUIDANCE", QUERY_WARNING_CODES, QUERY_WARNING_GUIDANCE],
];

describe("code guidance", () => {
  it.each(GUIDANCE)("%s covers exactly its codes, in their order", (_, codes, guidance) => {
    expect(Object.keys(guidance)).toEqual(codes);
  });

  it.each(GUIDANCE)("%s is deeply frozen with trimmed, non-empty text", (_, codes, guidance) => {
    expect(Object.isFrozen(guidance)).toBe(true);
    for (const code of codes) {
      const entry = guidance[code];
      expect(entry).toBeDefined();
      if (entry === undefined) continue;
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.keys(entry)).toEqual(["meaning", "response"]);
      for (const text of [entry.meaning, entry.response]) {
        expect(text.length).toBeGreaterThan(0);
        expect(text).toBe(text.trim());
        expect(text).toMatch(/\.$/u);
      }
    }
  });

  it("reuses the query entries for detection codes shared with query failures", () => {
    for (const code of DETECT_ERROR_CODES) {
      if (code === "NOT_DETECTED") continue;
      expect(DETECT_ERROR_GUIDANCE[code]).toBe(QUERY_ERROR_GUIDANCE[code]);
    }
    expect(DETECT_ERROR_GUIDANCE.NOT_DETECTED).toEqual({
      meaning: "No planned probe identified a supported game.",
      response: "Pass the port players connect to, or raise maxProbes.",
    });
  });

  it("rejects changes at run time", () => {
    const entry: { meaning: string } = QUERY_ERROR_GUIDANCE.TIMEOUT;
    expect(() => {
      entry.meaning = "changed";
    }).toThrow(TypeError);
    expect(QUERY_ERROR_GUIDANCE.TIMEOUT.meaning).toBe(
      "The required source did not answer before the query deadline.",
    );
  });
});
