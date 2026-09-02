/** Validates metadata that must remain true for a public QueryHost release. */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(repository, "package.json"), "utf8"));
const changelog = readFileSync(resolve(repository, "CHANGELOG.md"), "utf8");
const expectedRepository = "git+https://github.com/xIGBClutchIx/queryhost.git";
const expectedRegistry = "https://registry.npmjs.org/";

function requireReleaseMetadata(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

requireReleaseMetadata(manifest.name === "queryhost", "package.json name must equal queryhost.");
requireReleaseMetadata(
  /^\d+\.\d+\.\d+$/u.test(manifest.version),
  "package.json must contain a stable semantic version.",
);
requireReleaseMetadata(
  manifest.license === "Apache-2.0",
  "package.json license must equal Apache-2.0.",
);
requireReleaseMetadata(
  manifest.engines?.node === ">=24",
  "package.json must require Node.js 24 or newer.",
);
requireReleaseMetadata(
  manifest.bin?.queryhost === "dist/cli.js",
  "package.json must publish the queryhost command from dist/cli.js.",
);
requireReleaseMetadata(
  manifest.private === undefined,
  "package.json must not contain npm's private publish guard.",
);
requireReleaseMetadata(
  manifest.repository?.url === expectedRepository,
  `package.json repository.url must equal ${expectedRepository}.`,
);
requireReleaseMetadata(
  manifest.publishConfig?.access === "public" &&
    manifest.publishConfig?.registry === expectedRegistry,
  "package.json must pin public publication to the npm registry.",
);
requireReleaseMetadata(
  changelog.includes(`## [${manifest.version}] - `),
  `CHANGELOG.md must contain a dated ${manifest.version} release entry.`,
);

const releaseTag = process.argv[2];
if (releaseTag !== undefined) {
  requireReleaseMetadata(
    releaseTag === `v${manifest.version}`,
    `Release tag ${releaseTag} does not match package version ${manifest.version}.`,
  );
}

process.stdout.write(`Release metadata passed for queryhost ${manifest.version}.\n`);
