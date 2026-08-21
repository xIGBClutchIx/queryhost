/** Packs QueryHost, audits its contents, and consumes it from clean JavaScript and TypeScript fixtures. */

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(tmpdir(), "queryhost-package-smoke-"));
const fixture = join(repository, "test", "package-smoke");
const npmCommand = "npm";
const nodeCommand = process.execPath;
const tsc = join(repository, "node_modules", "typescript", "bin", "tsc");
const expectedRuntimeDependencies = Object.freeze({
  "@foxglove/wasm-bz2": "MIT",
  tslib: "0BSD",
});

function run(command, args, cwd = repository) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function packResult(output) {
  const document = JSON.parse(output);
  return Array.isArray(document) ? document[0] : Object.values(document)[0];
}

function packLocalPackage(path) {
  const output = run(npmCommand, [
    "pack",
    "--json",
    "--ignore-scripts",
    "--pack-destination",
    temporary,
    path,
  ]);
  const packed = packResult(output);
  assert(packed !== undefined, `npm pack did not report an artifact for ${path}.`);
  return join(temporary, packed.filename);
}

try {
  const sourceManifest = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
  assert(sourceManifest.private === true, "The source manifest must retain the publish guard.");
  assert(
    JSON.stringify(Object.keys(sourceManifest.dependencies ?? {}).sort()) ===
      JSON.stringify(["@foxglove/wasm-bz2"]),
    "The runtime dependency set changed without a package-hardening review.",
  );
  for (const [name, expectedLicense] of Object.entries(expectedRuntimeDependencies)) {
    const dependencyManifest = JSON.parse(
      readFileSync(join(repository, "node_modules", ...name.split("/"), "package.json"), "utf8"),
    );
    assert(
      dependencyManifest.license === expectedLicense,
      `${name} changed from the reviewed ${expectedLicense} license.`,
    );
  }

  const packOutput = run(npmCommand, ["pack", "--json", "--pack-destination", temporary]);
  const packed = packResult(packOutput);
  assert(packed !== undefined, "npm pack did not report an artifact.");
  assert(packed.size <= 250_000, `Packed package is too large: ${String(packed.size)} bytes.`);
  assert(
    packed.unpackedSize <= 1_500_000,
    `Unpacked package is too large: ${String(packed.unpackedSize)} bytes.`,
  );
  assert(
    packed.entryCount <= 300,
    `Packed package has too many files: ${String(packed.entryCount)}.`,
  );

  const paths = new Set(packed.files.map((file) => file.path));
  for (const required of [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "dist/cli.js",
    "dist/index.d.ts",
    "dist/index.js",
    "docs/api/README.md",
    "examples/basic.mjs",
    "examples/typed-query.ts",
    "package.json",
  ]) {
    assert(paths.has(required), `Packed package is missing ${required}.`);
  }
  for (const path of paths) {
    assert(!path.startsWith("src/"), `Packed package leaked source file ${path}.`);
    assert(!path.startsWith("test/"), `Packed package leaked test file ${path}.`);
    assert(!path.startsWith("scripts/"), `Packed package leaked script ${path}.`);
  }

  cpSync(fixture, temporary, { recursive: true });
  const archive = join(temporary, packed.filename);
  const bzipArchive = packLocalPackage(join(repository, "node_modules", "@foxglove", "wasm-bz2"));
  const tslibArchive = packLocalPackage(join(repository, "node_modules", "tslib"));
  run(
    npmCommand,
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      tslibArchive,
      bzipArchive,
      archive,
    ],
    temporary,
  );
  run(nodeCommand, [join(temporary, "consumer.mjs")], temporary);
  run(nodeCommand, [tsc, "--project", join(temporary, "tsconfig.json")], temporary);

  const installedManifest = JSON.parse(
    readFileSync(join(temporary, "node_modules", "queryhost", "package.json"), "utf8"),
  );
  assert(installedManifest.private === true, "The packed manifest lost the publish guard.");
  process.stdout.write(
    `Package smoke passed (${String(packed.size)} bytes packed, ${String(packed.entryCount)} files).\n`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
