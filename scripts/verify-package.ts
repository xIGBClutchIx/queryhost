import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    `import { QUERYHOST_NAME } from "queryhost";\n\nif (QUERYHOST_NAME !== "queryhost") {\n  throw new Error("Unexpected QueryHost package export.");\n}\n`,
  );

  await execFileAsync(
    process.execPath,
    [npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: consumerRoot },
  );
  await execFileAsync(process.execPath, ["index.mjs"], { cwd: consumerRoot });
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
