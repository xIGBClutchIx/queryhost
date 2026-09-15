/** Bounded network operations for Satisfactory's two credential-free status sources. */

import type { SatisfactoryHealth } from "../../contracts/games.js";
import type { PinnedAddress, PinnedTarget } from "../../network/target.js";
import type { ExecutionScope } from "../../runtime/execution.js";
import {
  fixedHttpExchange,
  HttpTransportError,
  type FixedHttpExchangeOptions,
  type FixedHttpExchangeResult,
  type HttpTransportDependencies,
} from "../../transports/http.js";
import {
  udpExchange,
  type UdpExchangeOptions,
  type UdpExchangeResult,
} from "../../transports/udp.js";
import { failSatisfactory } from "./errors.js";
import {
  encodeSatisfactoryPoll,
  parseSatisfactoryState,
  type SatisfactoryLightweightState,
} from "./lightweight.js";

const MAX_LIGHTWEIGHT_BYTES = 2_048;
const MAX_HEALTH_BYTES = 16_384;
const HEALTH_PATH = "/api/v1";
const HEALTH_REQUEST = new TextEncoder().encode(
  JSON.stringify({ function: "HealthCheck", data: { clientCustomData: "" } }),
);
type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };
interface JsonObject {
  [key: string]: JsonValue;
}

export interface SatisfactoryLightweightResult {
  readonly value: SatisfactoryLightweightState;
  readonly rttMs: number;
}

export interface SatisfactoryHealthResult {
  readonly value: SatisfactoryHealth;
  readonly rttMs: number;
}

export interface SatisfactoryQueryDependencies {
  readonly udpExchange?: (options: UdpExchangeOptions) => Promise<UdpExchangeResult>;
  readonly httpExchange?: (
    options: FixedHttpExchangeOptions,
    dependencies?: HttpTransportDependencies,
  ) => Promise<FixedHttpExchangeResult>;
  readonly http?: HttpTransportDependencies;
}

interface OperationOptions {
  readonly scope: ExecutionScope;
  readonly target: PinnedTarget;
  readonly address: PinnedAddress;
}

function object(value: JsonValue): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return failSatisfactory("MALFORMED_RESPONSE");
  }
  return value;
}

/** Parses the bounded lower-camel JSON emitted by the current Dedicated Server API. */
export function parseSatisfactoryHealth(data: Uint8Array): SatisfactoryHealth {
  let value: JsonValue;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)) as JsonValue;
  } catch {
    return failSatisfactory("MALFORMED_RESPONSE");
  }
  const envelope = object(value);
  const response = object(envelope["data"] ?? null);
  const health = response["health"];
  const serverCustomData = response["serverCustomData"];
  if (
    (health !== "healthy" && health !== "slow") ||
    typeof serverCustomData !== "string" ||
    serverCustomData.length > 8_192
  ) {
    return failSatisfactory("MALFORMED_RESPONSE");
  }
  return Object.freeze({ health, serverCustomData });
}

export async function querySatisfactoryLightweight(
  options: OperationOptions,
  cookie: bigint,
  dependencies: SatisfactoryQueryDependencies = {},
): Promise<SatisfactoryLightweightResult> {
  const result = await (dependencies.udpExchange ?? udpExchange)({
    ...options,
    request: encodeSatisfactoryPoll(cookie),
    maxResponseBytes: MAX_LIGHTWEIGHT_BYTES,
  });
  return Object.freeze({ value: parseSatisfactoryState(result.data, cookie), rttMs: result.rttMs });
}

export async function querySatisfactoryHealth(
  options: OperationOptions,
  dependencies: SatisfactoryQueryDependencies = {},
): Promise<SatisfactoryHealthResult> {
  const result = await (dependencies.httpExchange ?? fixedHttpExchange)(
    {
      ...options,
      protocol: "https",
      path: HEALTH_PATH,
      maxResponseBytes: MAX_HEALTH_BYTES,
      method: "POST",
      body: HEALTH_REQUEST,
      contentType: "application/json",
      // Vanilla servers generate self-signed certificates by default. The validated pinned target
      // still prevents DNS rebinding, while this policy provides encryption without server identity.
      tlsCertificatePolicy: "disabled",
    },
    dependencies.http,
  );
  if (result.statusCode < 200 || result.statusCode > 299) {
    throw new HttpTransportError("CONNECTION_FAILED");
  }
  return Object.freeze({ value: parseSatisfactoryHealth(result.data), rttMs: result.rttMs });
}
