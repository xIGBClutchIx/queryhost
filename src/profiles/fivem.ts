/** FiveM configuration for the shared Cfx FXServer HTTP profile. */

import type { CfxEndpointDefinition } from "../protocols/cfx/query.js";
import { queryCfxProfile, type CfxProfileOptions, type CfxProfileResult } from "./cfx.js";

/** Fixed endpoint identities used for FiveM result provenance. */
export const FIVEM_ENDPOINTS: CfxEndpointDefinition = Object.freeze({
  gameName: "FiveM",
  sources: Object.freeze({
    info: "fivem-info",
    dynamic: "fivem-dynamic",
    players: "fivem-players",
  }),
});

/** Queries FiveM through the game-neutral Cfx endpoint family. */
export function queryFiveMProfile(
  options: Omit<CfxProfileOptions, "definition">,
): Promise<CfxProfileResult> {
  return queryCfxProfile({ ...options, definition: FIVEM_ENDPOINTS });
}
