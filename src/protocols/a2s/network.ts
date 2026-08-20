/** Shared bounded network exchange used by every A2S request family. */

import type { ExecutionScope } from "../../execution.js";
import type { PinnedAddress, PinnedTarget } from "../../target.js";
import {
  udpCollect,
  type UdpCollectionOptions,
  type UdpCollectionResult,
} from "../../transports/udp.js";
import {
  A2S_MAX_COLLECTION_BYTES,
  A2S_MAX_DATAGRAM_BYTES,
  A2S_MAX_DATAGRAMS,
  isA2sResponseComplete,
  reconstructA2sResponse,
} from "./split.js";

/** Dependencies required to perform one A2S request and collect its response datagrams. */
export interface A2sExchangeDependencies {
  collect(options: UdpCollectionOptions): Promise<UdpCollectionResult>;
}

/** Validated destination and execution scope shared by direct A2S source queries. */
export interface A2sQueryOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly address: PinnedAddress;
}

/** Reconstructed A2S response and complete request round-trip duration. */
export interface A2sExchangeResult {
  readonly data: Uint8Array;
  readonly rttMs: number;
}

const DEFAULT_DEPENDENCIES: A2sExchangeDependencies = { collect: udpCollect };

/** Sends one A2S request and reconstructs a bounded single- or split-packet response. */
export async function exchangeA2s(
  options: A2sQueryOptions,
  request: Uint8Array,
  dependencies: A2sExchangeDependencies = DEFAULT_DEPENDENCIES,
): Promise<A2sExchangeResult> {
  const result = await dependencies.collect({
    scope: options.scope,
    target: options.target,
    address: options.address,
    request,
    maxResponseBytes: A2S_MAX_DATAGRAM_BYTES,
    maxDatagrams: A2S_MAX_DATAGRAMS,
    maxTotalResponseBytes: A2S_MAX_COLLECTION_BYTES,
    isComplete: isA2sResponseComplete,
  });
  return { data: await reconstructA2sResponse(result.datagrams), rttMs: result.rttMs };
}
