/** Packs QueryHost, audits its contents, and consumes it from clean JavaScript and TypeScript fixtures. */

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(tmpdir(), "queryhost-package-smoke-"));
const fixture = join(repository, "test", "package-smoke");
const nodeCommand = process.execPath;
// npm sets npm_execpath to its own CLI script when it runs this file. Running that script with
// Node avoids spawning the Windows `npm.cmd` shim, which execFileSync cannot start directly.
const npmCli = process.env.npm_execpath;
const npmInvocation =
  npmCli !== undefined && npmCli.endsWith(".js") ? [nodeCommand, [npmCli]] : ["npm", []];
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

function runNpm(args, cwd = repository) {
  const [command, prefix] = npmInvocation;
  return run(command, [...prefix, ...args], cwd);
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
  const output = runNpm([
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

/**
 * Keeps the README's hand-written game count and supported-games table equal to the packed
 * registry, so a new game or alias cannot ship with stale user documentation.
 */
function checkReadmeGames(readme, registry) {
  const games = registry.listGames();
  const aliasesByGame = new Map();
  for (const [alias, id] of Object.entries(registry.GAME_ALIASES)) {
    aliasesByGame.set(id, [...(aliasesByGame.get(id) ?? []), alias]);
  }
  const namedGames = games.filter((game) => game.id !== "a2s").length;
  assert(
    readme.includes(`**${String(namedGames)} games plus generic A2S.**`),
    `README.md must advertise ${String(namedGames)} games plus generic A2S.`,
  );
  const rows = readme.split("\n").filter((line) => /^\|[^|]+\| `[^`]+` +\|/u.test(line));
  assert(
    rows.length === games.length,
    `README.md lists ${String(rows.length)} games; the registry has ${String(games.length)}.`,
  );
  for (const game of games) {
    const row = rows.find((line) => line.includes(`| \`${game.id}\` `));
    assert(row !== undefined, `README.md is missing a supported-games row for ${game.id}.`);
    const cells = row
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const aliases = (aliasesByGame.get(game.id) ?? []).map((alias) => `\`${alias}\``);
    const expected = [
      game.name,
      `\`${game.id}\``,
      aliases.length === 0 ? "—" : aliases.join(", "),
      game.defaultPort === undefined ? "—" : String(game.defaultPort),
    ];
    assert(
      JSON.stringify(cells) === JSON.stringify(expected),
      `README.md row for ${game.id} must read: | ${expected.join(" | ")} |`,
    );
  }
}

try {
  const sourceManifest = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
  assert(
    sourceManifest.private === undefined,
    "The public package must not contain a publish guard.",
  );
  assert(
    sourceManifest.publishConfig?.access === "public" &&
      sourceManifest.publishConfig?.registry === "https://registry.npmjs.org/",
    "The source manifest must pin public npm registry publication.",
  );
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

  const packOutput = runNpm(["pack", "--json", "--pack-destination", temporary]);
  const packed = packResult(packOutput);
  assert(packed !== undefined, "npm pack did not report an artifact.");
  // Ceilings sit roughly 30% above the measured artifact; docs/ReleaseReadiness.md records them.
  assert(packed.size <= 300_000, `Packed package is too large: ${String(packed.size)} bytes.`);
  assert(
    packed.unpackedSize <= 1_250_000,
    `Unpacked package is too large: ${String(packed.unpackedSize)} bytes.`,
  );
  assert(
    packed.entryCount <= 450,
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
    // Maps would point at unshipped src/ files, and only the API reference is consumer-facing.
    assert(!path.endsWith(".map"), `Packed package contains source map ${path}.`);
    assert(
      !path.startsWith("docs/") || path.startsWith("docs/api/"),
      `Packed package leaked maintainer document ${path}.`,
    );
  }

  cpSync(fixture, temporary, { recursive: true });
  const archive = join(temporary, packed.filename);
  const bzipArchive = packLocalPackage(join(repository, "node_modules", "@foxglove", "wasm-bz2"));
  const tslibArchive = packLocalPackage(join(repository, "node_modules", "tslib"));
  runNpm(
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
  const installed = join(temporary, "node_modules", "queryhost");
  checkReadmeGames(
    readFileSync(join(installed, "README.md"), "utf8"),
    await import(pathToFileURL(join(installed, "dist", "registry.js")).href),
  );
  run(nodeCommand, [tsc, "--project", join(temporary, "tsconfig.json")], temporary);
  const commandHelp = runNpm(["exec", "--offline", "--", "queryhost", "--help"], temporary);
  assert(
    commandHelp.includes("QueryHost game-server query probe"),
    "The installed queryhost command did not run.",
  );

  const installedManifest = JSON.parse(
    readFileSync(join(temporary, "node_modules", "queryhost", "package.json"), "utf8"),
  );
  assert(installedManifest.private === undefined, "The packed manifest contains a publish guard.");
  assert(
    installedManifest.version === sourceManifest.version,
    "The installed package version differs from the source manifest.",
  );
  assert(
    installedManifest.bin?.queryhost === "dist/cli.js",
    "The packed manifest lost the queryhost command.",
  );
  process.stdout.write(
    `Package smoke passed (${String(packed.size)} bytes packed, ${String(packed.entryCount)} files).\n`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
