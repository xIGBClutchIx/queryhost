/** Shared request encoding and one-retry orchestration for challenge-based A2S sources. */

import { failA2s } from "./errors.js";
import { exchangeA2s, type A2sExchangeDependencies, type A2sQueryOptions } from "./network.js";

const REQUEST_HEADER_BYTES = 9;

/** Parsed challenge packet or source-specific response data. */
export type A2sChallengePacket<T> =
  | { readonly kind: "challenge"; readonly challenge: number }
  | { readonly kind: "data"; readonly value: T };

/** Successful challenge-based source query and its complete round-trip duration. */
export interface A2sChallengeQueryResult<T> {
  readonly value: T;
  readonly rttMs: number;
  readonly challenged: boolean;
}

/** Encodes an A2S request type followed by a signed 32-bit challenge token. */
export function encodeA2sChallengeRequest(requestType: number, challenge = -1): Uint8Array {
  if (
    !Number.isInteger(requestType) ||
    requestType < 0 ||
    requestType > 255 ||
    !Number.isInteger(challenge) ||
    challenge < -2_147_483_648 ||
    challenge > 2_147_483_647
  ) {
    return failA2s("INVALID_INPUT");
  }

  const request = new Uint8Array(REQUEST_HEADER_BYTES);
  request.set(Uint8Array.of(0xff, 0xff, 0xff, 0xff, requestType));
  new DataView(request.buffer).setInt32(5, challenge, true);
  return request;
}

/** Performs a challenge-based A2S source query with at most one retry. */
export async function queryA2sChallengeSource<T>(
  options: A2sQueryOptions,
  requestType: number,
  parse: (packet: Uint8Array) => A2sChallengePacket<T>,
  dependencies?: A2sExchangeDependencies,
): Promise<A2sChallengeQueryResult<T>> {
  const firstResponse = await exchangeA2s(
    options,
    encodeA2sChallengeRequest(requestType),
    dependencies,
  );
  const firstPacket = parse(firstResponse.data);
  if (firstPacket.kind === "data") {
    return { value: firstPacket.value, rttMs: firstResponse.rttMs, challenged: false };
  }

  const secondResponse = await exchangeA2s(
    options,
    encodeA2sChallengeRequest(requestType, firstPacket.challenge),
    dependencies,
  );
  const secondPacket = parse(secondResponse.data);
  if (secondPacket.kind === "challenge") {
    return failA2s("CHALLENGE_LIMIT");
  }
  return {
    value: secondPacket.value,
    rttMs: firstResponse.rttMs + secondResponse.rttMs,
    challenged: true,
  };
}
