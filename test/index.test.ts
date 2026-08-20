import { describe, expect, it } from "vitest";

import { QUERYHOST_NAME, query } from "../src/index.js";

describe("queryhost package", () => {
  it("exposes its package identity", () => {
    expect(QUERYHOST_NAME).toBe("queryhost");
  });

  it("exposes the public query function", async () => {
    expect(query).toBeTypeOf("function");
    await expect(
      query({ game: "minecraft-java", host: "play.example.com" }),
    ).resolves.toMatchObject({
      ok: false,
      game: "minecraft-java",
      error: { code: "UNSUPPORTED_GAME" },
    });
  });
});
