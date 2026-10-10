/** Crossplay hints inferred from data the Minecraft profiles already receive. */

import type { MinecraftCrossplayHint, MinecraftPlugin } from "../contracts/games.js";

// Geyser ships as Geyser-Spigot, Geyser-Velocity, and similar; Floodgate only runs beside Geyser.
const BRIDGE_PLUGIN = /^(?:geyser(?:[-_ ].*)?|floodgate(?:[-_ ].*)?)$/i;

// Geyser fills an empty sub-MOTD with its name, and its default config ships the second string.
// Only these exact defaults count: a vanilla level could be named anything else containing "Geyser".
const GEYSER_SUB_MOTDS: ReadonlySet<string> = new Set(["Geyser", "Another Geyser server."]);

const QUERY_PLUGINS_HINT: { readonly crossplay: MinecraftCrossplayHint } = Object.freeze({
  crossplay: Object.freeze({ bridge: "geyser", evidence: "query-plugins" }),
});

const BEDROCK_SUB_MOTD_HINT: { readonly crossplay: MinecraftCrossplayHint } = Object.freeze({
  crossplay: Object.freeze({ bridge: "geyser", evidence: "bedrock-sub-motd" }),
});

/** Returns a spreadable hint when Java Query plugins include a Bedrock bridge. */
export function javaCrossplay(plugins: readonly MinecraftPlugin[] | undefined): {
  readonly crossplay?: MinecraftCrossplayHint;
} {
  return plugins?.some((plugin) => BRIDGE_PLUGIN.test(plugin.name.trim())) === true
    ? QUERY_PLUGINS_HINT
    : {};
}

/** Returns a spreadable hint when a Bedrock pong carries a Geyser default sub-MOTD. */
export function bedrockCrossplay(subMotd: string | undefined): {
  readonly crossplay?: MinecraftCrossplayHint;
} {
  return subMotd !== undefined && GEYSER_SUB_MOTDS.has(subMotd.trim()) ? BEDROCK_SUB_MOTD_HINT : {};
}
