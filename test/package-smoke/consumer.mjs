import * as queryhost from "queryhost";

const expectedExports = [
  "GAME_ALIASES",
  "GAME_IDS",
  "GAME_REGISTRY",
  "canonicalGameId",
  "getGameDefinition",
  "isGameAlias",
  "isGameId",
  "isGameInputId",
  "listGames",
  "query",
].sort();
const actualExports = Object.keys(queryhost).sort();
if (JSON.stringify(actualExports) !== JSON.stringify(expectedExports)) {
  throw new Error(`The packed public exports changed: ${actualExports.join(", ")}.`);
}

const { GAME_IDS, GAME_REGISTRY, canonicalGameId } = queryhost;

if (!GAME_IDS.includes("fivem") || !GAME_IDS.includes("dont-starve-together")) {
  throw new Error("The packed JavaScript entry point omitted a supported profile.");
}
if (!GAME_IDS.includes("redm") || GAME_REGISTRY.redm.defaultPort !== 30_120) {
  throw new Error("The packed JavaScript entry point omitted RedM metadata.");
}
if (!GAME_IDS.includes("vintage-story")) {
  throw new Error("The packed JavaScript entry point omitted Vintage Story.");
}
if (
  GAME_REGISTRY["team-fortress-2"].defaultPort !== 27_015 ||
  canonicalGameId("cs2") !== "counter-strike-2"
) {
  throw new Error("The packed JavaScript entry point omitted Source-engine metadata.");
}
if (GAME_REGISTRY["minecraft-java"].defaultPort !== 25_565) {
  throw new Error("The packed registry returned the wrong Minecraft Java port.");
}
if (GAME_REGISTRY.dayz.defaultQueryPort !== 2_305) {
  throw new Error("The DayZ registry entry is missing its Steam query port.");
}
if (canonicalGameId("7d2d") !== "7-days-to-die") {
  throw new Error("The packed alias resolver returned the wrong canonical game.");
}
if (canonicalGameId("vs") !== "vintage-story") {
  throw new Error("The packed Vintage Story alias resolved incorrectly.");
}
if (GAME_REGISTRY["vintage-story"].defaultPort !== 42_420) {
  throw new Error("The packed registry returned the wrong Vintage Story port.");
}
if (canonicalGameId("dst") !== "dont-starve-together") {
  throw new Error("The packed DST alias resolved to the wrong canonical game.");
}

let internalModuleBlocked = false;
try {
  await import("queryhost/transports/http");
} catch (error) {
  internalModuleBlocked = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
}
if (!internalModuleBlocked) {
  throw new Error("An internal transport became importable through the package exports map.");
}
