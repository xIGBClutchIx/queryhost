import { describe, expect, it } from "vitest";

import { QUERYHOST_NAME } from "../src/index.js";

describe("queryhost package", () => {
  it("exposes its package identity", () => {
    expect(QUERYHOST_NAME).toBe("queryhost");
  });
});
