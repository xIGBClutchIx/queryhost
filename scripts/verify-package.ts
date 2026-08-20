/** Verifies the actual npm tarball through a fresh JavaScript consumer installation. */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = new URL("..", import.meta.url);
const temporaryRoot = await mkdtemp(join(tmpdir(), "queryhost-package-"));
const npmCli = process.env["npm_execpath"];

if (npmCli === undefined) {
  throw new Error("Package verification must run through npm.");
}

try {
  // Test the packed artifact rather than importing the working tree. This catches missing files,
  // incorrect exports, and install-time differences that source-level tests cannot see.
  const { stdout } = await execFileAsync(
    process.execPath,
    [npmCli, "pack", "--json", "--pack-destination", temporaryRoot],
    { cwd: packageRoot },
  );
  const filename = /"filename"\s*:\s*"([^"]+\.tgz)"/u.exec(stdout)?.[1];

  if (filename === undefined) {
    throw new Error("npm pack did not report a tarball filename.");
  }

  const consumerRoot = join(temporaryRoot, "consumer");
  const tarballPath = join(temporaryRoot, filename).replaceAll("\\", "/");
  await mkdir(consumerRoot);
  await writeFile(
    join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "queryhost-package-consumer",
        private: true,
        type: "module",
        dependencies: {
          queryhost: `file:${tarballPath}`,
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(consumerRoot, "index.mjs"),
    `import { createSocket } from "node:dgram";

import { QUERYHOST_NAME, query } from "queryhost";

if (QUERYHOST_NAME !== "queryhost" || typeof query !== "function") {
  throw new Error("Unexpected QueryHost package exports.");
}

const installedPackage = new URL("./node_modules/queryhost/", import.meta.url);
const { createExecutionContext } = await import(new URL("dist/execution.js", installedPackage));
const { queryRustProfile } = await import(new URL("dist/profiles/rust.js", installedPackage));
const packets = new Map([
  [0x54, Buffer.from("ffffffff49115175657279486f7374205275737420466978747572650050726f6365647572616c204d617000727573740052757374004ada0c6400646c00013236303000206d703130302c6370302c7765656b6c792c76616e696c6c6100", "hex")],
  [0x55, Buffer.from("ffffffff440200416c696365000a0000000000f74201426f6200feffffff00001040", "hex")],
  [0x56, Buffer.from("ffffffff450400686f73746e616d65005175657279486f73742052757374204669787475726500776f726c642e736565640031323334353600776f726c642e73697a650034353030007076650066616c736500", "hex")],
]);
const socket = createSocket("udp4");
socket.on("message", (request, remote) => {
  const response = packets.get(request[4]);
  if (response !== undefined) {
    socket.send(response, remote.port, remote.address);
  }
});
await new Promise((resolve, reject) => {
  const handleError = (error) => reject(error);
  socket.once("error", handleError);
  socket.bind(0, "127.0.0.1", () => {
    socket.off("error", handleError);
    resolve();
  });
});
const bound = socket.address();
if (typeof bound === "string") {
  throw new Error("Expected a UDP socket address.");
}
const address = Object.freeze({ address: "127.0.0.1", family: 4 });
const target = Object.freeze({
  hostname: address.address,
  port: bound.port,
  addresses: Object.freeze([address]),
});
const scope = createExecutionContext({ timeoutMs: 1_000 });
try {
  const result = await queryRustProfile({
    scope,
    target,
    mode: "full",
    observer: { onSourceStarted() {}, onSourceCompleted() {} },
  });
  if (
    result.server.name !== "QueryHost Rust Fixture" ||
    result.data.players?.length !== 2 ||
    result.data.rules?.["world.seed"] !== "123456" ||
    result.sources.some((source) => source.status !== "ok")
  ) {
    throw new Error("The packed Rust profile produced an unexpected result.");
  }
} finally {
  scope.close();
  await new Promise((resolve) => socket.close(resolve));
}
`,
  );

  await execFileAsync(
    process.execPath,
    [npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: consumerRoot },
  );
  // The final process proves Node can resolve and execute the package from a clean consumer.
  await execFileAsync(process.execPath, ["index.mjs"], { cwd: consumerRoot });
  const installedPackageRoot = join(consumerRoot, "node_modules", "queryhost");
  const installedManifest = await readFile(join(installedPackageRoot, "package.json"), "utf8");
  if (!/"queryhost"\s*:\s*"\.\/dist\/cli\.js"/u.test(installedManifest)) {
    throw new Error("The packed package did not retain the QueryHost command mapping.");
  }
  const { stdout: help } = await execFileAsync(
    process.execPath,
    [join(installedPackageRoot, "dist", "cli.js"), "--help"],
    { cwd: consumerRoot },
  );
  if (!help.includes("queryhost <game> <host> [port]") || !help.includes("--query-port <port>")) {
    throw new Error("The packed QueryHost command did not provide the expected help output.");
  }
} finally {
  // Package verification must not leave tarballs, installs, or caches in the repository.
  await rm(temporaryRoot, { force: true, recursive: true });
}
