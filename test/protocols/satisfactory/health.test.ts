import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SatisfactoryProtocolError } from "../../../src/protocols/satisfactory/errors.js";
import { parseSatisfactoryHealth } from "../../../src/protocols/satisfactory/query.js";

const FIXTURE = new TextEncoder().encode(
  readFileSync(new URL("../../fixtures/satisfactory/health.json", import.meta.url), "utf8"),
);

describe("Satisfactory HTTPS HealthCheck", (): void => {
  it("preserves a confirmed empty custom-data field", (): void => {
    expect(parseSatisfactoryHealth(FIXTURE)).toEqual({
      health: "healthy",
      serverCustomData: "",
    });
  });

  it("accepts the documented slow state", (): void => {
    expect(
      parseSatisfactoryHealth(
        new TextEncoder().encode('{"data":{"health":"slow","serverCustomData":"mod"}}'),
      ),
    ).toEqual({ health: "slow", serverCustomData: "mod" });
  });

  it.each([
    "{}",
    '{"data":{"health":"unknown","serverCustomData":""}}',
    '{"data":{"health":"healthy"}}',
    '{"data":{"health":"healthy","serverCustomData":3}}',
    "{",
  ])("rejects malformed response %s", (body): void => {
    expect(() => parseSatisfactoryHealth(new TextEncoder().encode(body))).toThrow(
      SatisfactoryProtocolError,
    );
  });
});
