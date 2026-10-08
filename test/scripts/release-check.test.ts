import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = new URL("../../scripts/release-check.mjs", import.meta.url);
const MANIFEST = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
const CHANGELOG = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
const VERSION = (JSON.parse(MANIFEST) as { readonly version: string }).version;
const RELEASE_LINK = `[${VERSION}]: https://github.com/xIGBClutchIx/queryhost/releases/tag/v${VERSION}`;

const roots: string[] = [];

function runCheck(changelog: string): { readonly status: number | null; readonly stderr: string } {
  const root = mkdtempSync(join(tmpdir(), "queryhost-release-check-"));
  roots.push(root);
  mkdirSync(join(root, "scripts"));
  copyFileSync(SCRIPT, join(root, "scripts", "release-check.mjs"));
  writeFileSync(join(root, "package.json"), MANIFEST);
  writeFileSync(join(root, "CHANGELOG.md"), changelog);
  const result = spawnSync(process.execPath, [join(root, "scripts", "release-check.mjs")], {
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("release metadata check", () => {
  it("passes when the current version heading links to its release", () => {
    expect(CHANGELOG).toContain(`\n${RELEASE_LINK}\n`);
    expect(runCheck(CHANGELOG).status).toBe(0);
  });

  it("fails when the current version's release link is missing", () => {
    const result = runCheck(CHANGELOG.replace(`${RELEASE_LINK}\n`, ""));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`must link the ${VERSION} heading to its GitHub release`);
  });

  it("fails when the current version's release link points at another tag", () => {
    const result = runCheck(CHANGELOG.replace(RELEASE_LINK, `${RELEASE_LINK}-rc`));

    expect(result.status).not.toBe(0);
  });
});
