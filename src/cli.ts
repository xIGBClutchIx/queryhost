#!/usr/bin/env node
/** QueryHost command-line probe for fast real-server testing. */

import { EXIT_INTERRUPTED, runCli } from "./cli/main.js";
import { query } from "./runtime/client.js";
import { detect } from "./runtime/detect.js";

const cancellation = new AbortController();
// Ctrl+C aborts the active query so its normal cleanup closes network resources.
const cancel = (): void => {
  cancellation.abort();
};
process.once("SIGINT", cancel);
try {
  process.exitCode = await runCli(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    signal: cancellation.signal,
    query,
    detect,
  });
} catch {
  process.stderr.write("QueryHost could not complete the command.\n");
  process.exitCode = cancellation.signal.aborted ? EXIT_INTERRUPTED : 1;
} finally {
  process.off("SIGINT", cancel);
}
