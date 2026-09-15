/** RedM configuration for the shared Cfx FXServer HTTP profile. */

import type { CfxEndpointDefinition } from "../protocols/cfx/query.js";
import { queryCfxProfile, type CfxProfileOptions, type CfxProfileResult } from "./cfx.js";

/** Fixed endpoint identities used for RedM result provenance. */
export const REDM_ENDPOINTS: CfxEndpointDefinition = Object.freeze({
  gameName: "RedM",
  sources: Object.freeze({
    info: "redm-info",
    dynamic: "redm-dynamic",
    players: "redm-players",
  }),
});

/** Queries RedM through the game-neutral Cfx endpoint family. */
export function queryRedMProfile(
  options: Omit<CfxProfileOptions, "definition">,
): Promise<CfxProfileResult> {
  return queryCfxProfile({ ...options, definition: REDM_ENDPOINTS });
}
