/** Internal helpers shared by the UDP, TCP, HTTP, and QUIC transports. */

import { isIP } from "node:net";

import { normalizeIpAddress } from "../network/ip.js";
import type { PinnedAddress } from "../network/target.js";
import type { ExecutionScope } from "../runtime/execution.js";

/** Whether two pinned addresses name the same IP literal in the same family. */
export function addressesMatch(left: PinnedAddress, right: PinnedAddress): boolean {
  const normalizedLeft = normalizeIpAddress(left.address);
  const normalizedRight = normalizeIpAddress(right.address);
  return (
    normalizedLeft !== undefined &&
    normalizedRight !== undefined &&
    isIP(normalizedLeft) === left.family &&
    isIP(normalizedRight) === right.family &&
    left.family === right.family &&
    normalizedLeft === normalizedRight
  );
}

/** Maps a terminated scope to the transport code for its cause. */
export function terminationCode(scope: ExecutionScope): "ABORTED" | "TIMEOUT" {
  return scope.getError()?.code === "TIMEOUT" ? "TIMEOUT" : "ABORTED";
}
