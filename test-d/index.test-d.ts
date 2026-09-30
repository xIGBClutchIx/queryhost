import { expectAssignable, expectError, expectNotAssignable, expectType } from "tsd";

import {
  type Arma3Data,
  type Arma3Difficulty,
  type Arma3Mod,
  type AmericanTruckSimulatorData,
  type EuroTruckSimulator2Data,
  type TheForestData,
  type UnturnedData,
  type EnshroudedData,
  type InsurgencySandstormData,
  type ArkSurvivalEvolvedData,
  type ConanExilesData,
  type KillingFloor2Data,
  type DayOfDragonsData,
  type SoulmaskData,
  type SonsOfTheForestData,
  type IcarusData,
  type AbioticFactorData,
  type A2sData,
  type A2sPlayer,
  type CounterStrike2Data,
  type CounterStrikeSourceData,
  type DayZData,
  type DayZMod,
  type DayZRawData,
  type DontStarveTogetherData,
  type DontStarveTogetherPlayer,
  canonicalGameId,
  GAME_IDS,
  getGameDefinition,
  isGameId,
  query,
  type FiveMData,
  type FiveMPlayer,
  type GameAlias,
  type GameDataMap,
  type GameRawDataMap,
  type GameId,
  type GarrysModData,
  type Left4Dead2Data,
  type Left4DeadData,
  type MinecraftBedrockData,
  type MinecraftJavaData,
  type PalworldData,
  type PalworldPlayer,
  type ProjectZomboidData,
  type ProjectZomboidPlayer,
  type RedMData,
  type RedMPlayer,
  type QueryError,
  type QueryInput,
  type QueryResult,
  type RustData,
  type RustPlayer,
  type SevenDaysToDieData,
  type SevenDaysToDiePlayer,
  type SatisfactoryData,
  type SatisfactoryRawData,
  type SteamA2sData,
  type SteamA2sPlayer,
  type TeamFortress2Data,
  type VintageStoryData,
  type ValheimData,
  type ValheimPlayer,
} from "queryhost";

expectType<
  readonly [
    "a2s",
    "dont-starve-together",
    "rust",
    "palworld",
    "project-zomboid",
    "7-days-to-die",
    "dayz",
    "valheim",
    "minecraft-java",
    "minecraft-bedrock",
    "fivem",
    "redm",
    "satisfactory",
    "vintage-story",
    "counter-strike-2",
    "counter-strike-source",
    "team-fortress-2",
    "left-4-dead",
    "left-4-dead-2",
    "garrys-mod",
    "ark-survival-evolved",
    "conan-exiles",
    "killing-floor-2",
    "day-of-dragons",
    "soulmask",
    "sons-of-the-forest",
    "icarus",
    "abiotic-factor",
    "arma-3",
    "american-truck-simulator",
    "euro-truck-simulator-2",
    "the-forest",
    "unturned",
    "enshrouded",
    "insurgency-sandstorm",
  ]
>(GAME_IDS);

expectType<Promise<QueryResult<"a2s">>>(
  query({ game: "a2s", host: "play.example.com", port: 27_015 }),
);
expectError(query({ game: "a2s", host: "play.example.com" }));
expectError(query({ game: "a2s", host: "play.example.com", port: 27_015, queryPort: 27_016 }));
expectType<Promise<QueryResult<"dont-starve-together">>>(
  query({ game: "dont-starve-together", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"dont-starve-together">>>(
  query({ game: "dst", host: "play.example.com", port: 11_000, queryPort: 27_018 }),
);

const rustInput: QueryInput<"rust"> = {
  game: "rust",
  host: "play.example.com",
  mode: "full",
};
expectType<"rust">(rustInput.game);
expectType<Promise<QueryResult<"rust">>>(query(rustInput));
expectType<Promise<QueryResult<"palworld">>>(query({ game: "palworld", host: "play.example.com" }));
expectType<Promise<QueryResult<"project-zomboid">>>(
  query({ game: "project-zomboid", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"7-days-to-die">>>(
  query({ game: "7-days-to-die", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"dayz">>>(query({ game: "dayz", host: "play.example.com" }));
expectType<Promise<QueryResult<"valheim">>>(query({ game: "valheim", host: "play.example.com" }));
expectType<Promise<QueryResult<"7-days-to-die">>>(
  query({ game: "7d2d", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"7-days-to-die">>>(
  query({ game: "seven-days-to-die", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"project-zomboid">>>(
  query({ game: "zomboid", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"minecraft-java">>>(query({ game: "mc", host: "play.example.com" }));
expectType<Promise<QueryResult<"minecraft-bedrock">>>(
  query({ game: "mcbe", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"fivem">>>(query({ game: "five-m", host: "play.example.com" }));
expectType<Promise<QueryResult<"redm">>>(query({ game: "red-m", host: "play.example.com" }));
expectType<Promise<QueryResult<"redm">>>(query({ game: "rdr3", host: "play.example.com" }));
expectType<Promise<QueryResult<"satisfactory">>>(
  query({ game: "satisfactory", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"vintage-story">>>(query({ game: "vs", host: "play.example.com" }));
expectType<Promise<QueryResult<"counter-strike-2">>>(
  query({ game: "cs2", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"counter-strike-source">>>(
  query({ game: "css", host: "play.example.com", port: 27_016 }),
);
expectType<Promise<QueryResult<"team-fortress-2">>>(
  query({ game: "tf2", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"left-4-dead">>>(query({ game: "l4d", host: "play.example.com" }));
expectType<Promise<QueryResult<"left-4-dead-2">>>(
  query({ game: "l4d2", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"garrys-mod">>>(
  query({ game: "gmod", host: "play.example.com", queryPort: 27_016 }),
);
expectType<Promise<QueryResult<"ark-survival-evolved">>>(
  query({ game: "ark", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"conan-exiles">>>(
  query({ game: "conan", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"killing-floor-2">>>(
  query({ game: "kf2", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"day-of-dragons">>>(
  query({ game: "dayofdragons", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"soulmask">>>(query({ game: "soulmask", host: "play.example.com" }));
expectType<Promise<QueryResult<"sons-of-the-forest">>>(
  query({ game: "sotf", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"icarus">>>(query({ game: "icarus", host: "play.example.com" }));
expectType<Promise<QueryResult<"abiotic-factor">>>(
  query({ game: "abioticfactor", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"arma-3">>>(query({ game: "arma3", host: "play.example.com" }));
expectType<Promise<QueryResult<"american-truck-simulator">>>(
  query({ game: "ats", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"euro-truck-simulator-2">>>(
  query({ game: "ets2", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"the-forest">>>(
  query({ game: "theforest", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"unturned">>>(query({ game: "unturned", host: "play.example.com" }));
expectType<Promise<QueryResult<"enshrouded">>>(
  query({ game: "enshrouded", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"insurgency-sandstorm">>>(
  query({ game: "sandstorm", host: "play.example.com" }),
);
expectNotAssignable<QueryInput>({ game: "counter-strike", host: "play.example.com" });

declare const dynamicInput: QueryInput;
expectType<Promise<QueryResult>>(query(dynamicInput));

expectType<"rust">(getGameDefinition("rust").id);
expectType<"dont-starve-together">(getGameDefinition("dst").id);
expectType<"project-zomboid">(getGameDefinition("pz").id);
expectType<"minecraft-java">(getGameDefinition("minecraft").id);
expectType<"7-days-to-die">(canonicalGameId("7d2d"));
expectType<"vintage-story">(canonicalGameId("vintagestory"));
expectAssignable<GameAlias>("seven-days-to-die");
expectType<number | undefined>(getGameDefinition("rust").defaultQueryPort);
expectType<"offset" | "fixed" | undefined>(
  getGameDefinition("dont-starve-together").queryPortStrategy,
);
expectType<number | undefined>(getGameDefinition("minecraft-java").defaultPort);
expectType<number | undefined>(getGameDefinition("a2s").defaultPort);

declare const candidate: string;
if (isGameId(candidate)) {
  expectType<GameId>(candidate);
}

declare const rustResult: QueryResult<"rust">;
if (rustResult.ok) {
  expectType<RustData>(rustResult.data);
  expectType<GameRawDataMap["rust"] | undefined>(rustResult.rawData);
} else {
  expectType<QueryError>(rustResult.error);
  expectError(rustResult.data);
  expectError(rustResult.rawData);
}

declare const dynamicResult: QueryResult;
if (dynamicResult.ok) {
  switch (dynamicResult.game) {
    case "a2s":
      expectType<A2sData>(dynamicResult.data);
      break;
    case "dont-starve-together":
      expectType<DontStarveTogetherData>(dynamicResult.data);
      break;
    case "rust":
      expectType<RustData>(dynamicResult.data);
      break;
    case "palworld":
      expectType<PalworldData>(dynamicResult.data);
      break;
    case "project-zomboid":
      expectType<ProjectZomboidData>(dynamicResult.data);
      break;
    case "7-days-to-die":
      expectType<SevenDaysToDieData>(dynamicResult.data);
      break;
    case "dayz":
      expectType<DayZData>(dynamicResult.data);
      break;
    case "valheim":
      expectType<ValheimData>(dynamicResult.data);
      break;
    case "minecraft-java":
      expectType<MinecraftJavaData>(dynamicResult.data);
      break;
    case "minecraft-bedrock":
      expectType<MinecraftBedrockData>(dynamicResult.data);
      break;
    case "fivem":
      expectType<FiveMData>(dynamicResult.data);
      break;
    case "redm":
      expectType<RedMData>(dynamicResult.data);
      break;
    case "satisfactory":
      expectType<SatisfactoryData>(dynamicResult.data);
      expectType<SatisfactoryRawData | undefined>(dynamicResult.rawData);
      break;
    case "vintage-story":
      expectType<VintageStoryData>(dynamicResult.data);
      break;
    case "counter-strike-2":
      expectType<CounterStrike2Data>(dynamicResult.data);
      break;
    case "counter-strike-source":
      expectType<CounterStrikeSourceData>(dynamicResult.data);
      break;
    case "team-fortress-2":
      expectType<TeamFortress2Data>(dynamicResult.data);
      break;
    case "left-4-dead":
      expectType<Left4DeadData>(dynamicResult.data);
      break;
    case "left-4-dead-2":
      expectType<Left4Dead2Data>(dynamicResult.data);
      break;
    case "garrys-mod":
      expectType<GarrysModData>(dynamicResult.data);
      break;
    case "ark-survival-evolved":
      expectType<ArkSurvivalEvolvedData>(dynamicResult.data);
      break;
    case "conan-exiles":
      expectType<ConanExilesData>(dynamicResult.data);
      break;
    case "killing-floor-2":
      expectType<KillingFloor2Data>(dynamicResult.data);
      break;
    case "day-of-dragons":
      expectType<DayOfDragonsData>(dynamicResult.data);
      break;
    case "soulmask":
      expectType<SoulmaskData>(dynamicResult.data);
      break;
    case "sons-of-the-forest":
      expectType<SonsOfTheForestData>(dynamicResult.data);
      break;
    case "icarus":
      expectType<IcarusData>(dynamicResult.data);
      break;
    case "abiotic-factor":
      expectType<AbioticFactorData>(dynamicResult.data);
      break;
    case "arma-3":
      expectType<Arma3Data>(dynamicResult.data);
      break;
    case "american-truck-simulator":
      expectType<AmericanTruckSimulatorData>(dynamicResult.data);
      break;
    case "euro-truck-simulator-2":
      expectType<EuroTruckSimulator2Data>(dynamicResult.data);
      break;
    case "the-forest":
      expectType<TheForestData>(dynamicResult.data);
      break;
    case "unturned":
      expectType<UnturnedData>(dynamicResult.data);
      break;
    case "enshrouded":
      expectType<EnshroudedData>(dynamicResult.data);
      break;
    case "insurgency-sandstorm":
      expectType<InsurgencySandstormData>(dynamicResult.data);
      break;
  }
} else {
  expectType<QueryError>(dynamicResult.error);
  expectError(dynamicResult.data);
}

declare const dataMap: GameDataMap;
declare const rawDataMap: GameRawDataMap;
expectType<Readonly<Record<string, string>>>(rawDataMap["project-zomboid"].rules);
expectType<Readonly<Record<string, string>>>(rawDataMap.palworld.rules);
expectType<A2sData>(dataMap.a2s);
expectType<readonly A2sPlayer[] | undefined>(dataMap.a2s.players);
expectType<DontStarveTogetherData>(dataMap["dont-starve-together"]);
expectType<readonly DontStarveTogetherPlayer[] | undefined>(
  dataMap["dont-starve-together"].players,
);
expectType<Readonly<Record<string, string>>>(rawDataMap["dont-starve-together"].rules);
expectType<RustData>(dataMap.rust);
expectType<readonly RustPlayer[] | undefined>(dataMap.rust.players);
expectType<PalworldData>(dataMap.palworld);
expectType<readonly PalworldPlayer[] | undefined>(dataMap.palworld.players);
expectType<readonly ProjectZomboidPlayer[] | undefined>(dataMap["project-zomboid"].players);
expectType<readonly string[] | undefined>(dataMap["project-zomboid"].mods);
expectType<readonly SevenDaysToDiePlayer[] | undefined>(dataMap["7-days-to-die"].players);
expectType<string | undefined>(dataMap["7-days-to-die"].currentServerTime);
expectType<DayZData>(dataMap.dayz);
expectType<readonly string[] | undefined>(dataMap.dayz.tags);
expectType<boolean | undefined>(dataMap.dayz.dedicated);
expectType<number | undefined>(dataMap.dayz.clientPort);
expectType<readonly DayZMod[] | undefined>(dataMap.dayz.mods);
expectType<string | undefined>(dataMap.dayz.mods?.[0]?.workshopId);
expectType<Readonly<Record<string, string>>>(rawDataMap.dayz.rules);
expectType<DayZRawData>(rawDataMap.dayz);
expectType<ValheimData>(dataMap.valheim);
expectType<"steam">(dataMap.valheim.backend);
expectType<string | undefined>(dataMap.valheim.networkVersion);
expectType<readonly ValheimPlayer[] | undefined>(dataMap.valheim.players);
expectType<never>(rawDataMap.valheim);
expectType<MinecraftJavaData>(dataMap["minecraft-java"]);
expectType<string | undefined>(dataMap["minecraft-java"].motd?.plain);
expectType<number | undefined>(dataMap["minecraft-java"].protocolVersion);
expectType<readonly string[] | undefined>(dataMap["minecraft-java"].players);
expectType<string | undefined>(dataMap["minecraft-java"].software?.name);
expectType<string | undefined>(dataMap["minecraft-java"].plugins?.[0]?.name);
expectType<string | undefined>(dataMap["minecraft-java"].srv?.host);
expectType<MinecraftBedrockData>(dataMap["minecraft-bedrock"]);
expectType<string | undefined>(dataMap["minecraft-bedrock"].edition);
expectType<string | undefined>(dataMap["minecraft-bedrock"].motd);
expectType<number | undefined>(dataMap["minecraft-bedrock"].protocolVersion);
expectType<string | undefined>(dataMap["minecraft-bedrock"].gameMode);
expectType<string | undefined>(dataMap["minecraft-bedrock"].serverId);
expectType<number | undefined>(dataMap["minecraft-bedrock"].advertisedIpv4Port);
expectType<number | undefined>(dataMap["minecraft-bedrock"].advertisedIpv6Port);
expectType<FiveMData>(dataMap.fivem);
expectType<readonly string[] | undefined>(dataMap.fivem.resources);
expectType<Readonly<Record<string, string>> | undefined>(dataMap.fivem.variables);
expectType<readonly FiveMPlayer[] | undefined>(dataMap.fivem.players);
expectType<string | undefined>(dataMap.fivem.gameType);
expectType<boolean | undefined>(dataMap.fivem.oneSyncEnabled);
expectType<RedMData>(dataMap.redm);
expectType<readonly RedMPlayer[] | undefined>(dataMap.redm.players);
expectType<readonly string[] | undefined>(dataMap.redm.resources);
expectType<Readonly<Record<string, string>> | undefined>(dataMap.redm.variables);
expectType<SatisfactoryData>(dataMap.satisfactory);
expectType<"idle" | "loading" | "playing">(dataMap.satisfactory.state);
expectType<number>(dataMap.satisfactory.serverNetCl);
expectType<boolean>(dataMap.satisfactory.modded);
expectType<"healthy" | "slow" | undefined>(dataMap.satisfactory.health);
expectType<string>(rawDataMap.satisfactory.serverFlags);
expectType<number | undefined>(rawDataMap.satisfactory.subStates[0]?.version);
expectType<string | undefined>(rawDataMap.satisfactory.health?.serverCustomData);
expectType<VintageStoryData>(dataMap["vintage-story"]);
expectType<"liveness" | "status">(dataMap["vintage-story"].response);
expectType<string | undefined>(dataMap["vintage-story"].motd);
expectAssignable<SteamA2sData>(dataMap["counter-strike-2"]);
expectAssignable<SteamA2sData>(dataMap["garrys-mod"]);
expectType<string>(dataMap["team-fortress-2"].folder);
expectType<number | undefined>(dataMap["team-fortress-2"].appId);
expectType<readonly string[] | undefined>(dataMap["counter-strike-2"].tags);
expectType<number | undefined>(dataMap["counter-strike-source"].sourceTv?.port);
expectType<readonly SteamA2sPlayer[] | undefined>(dataMap["left-4-dead-2"].players);
expectType<Readonly<Record<string, string>>>(rawDataMap["left-4-dead"].rules);
expectAssignable<SteamA2sData>(dataMap["ark-survival-evolved"]);
expectAssignable<SteamA2sData>(dataMap["conan-exiles"]);
expectAssignable<SteamA2sData>(dataMap["killing-floor-2"]);
expectAssignable<SteamA2sData>(dataMap["day-of-dragons"]);
expectAssignable<SteamA2sData>(dataMap["soulmask"]);
expectAssignable<SteamA2sData>(dataMap["sons-of-the-forest"]);
expectAssignable<SteamA2sData>(dataMap["icarus"]);
expectAssignable<SteamA2sData>(dataMap["abiotic-factor"]);
expectType<readonly SteamA2sPlayer[] | undefined>(dataMap["conan-exiles"].players);
expectType<Readonly<Record<string, string>>>(rawDataMap.soulmask.rules);
expectAssignable<SteamA2sData>(dataMap["arma-3"]);
expectAssignable<SteamA2sData>(dataMap["american-truck-simulator"]);
expectAssignable<SteamA2sData>(dataMap["euro-truck-simulator-2"]);
expectAssignable<SteamA2sData>(dataMap["the-forest"]);
expectAssignable<SteamA2sData>(dataMap["unturned"]);
expectAssignable<SteamA2sData>(dataMap["enshrouded"]);
expectAssignable<SteamA2sData>(dataMap["insurgency-sandstorm"]);
expectType<Readonly<Record<string, string>>>(rawDataMap["arma-3"].rules);
expectType<readonly Arma3Mod[] | undefined>(dataMap["arma-3"].mods);
expectType<Arma3Difficulty | undefined>(dataMap["arma-3"].difficulty);
expectType<Readonly<Record<string, string>>>(rawDataMap.unturned.rules);
expectType<number | undefined>(getGameDefinition("sotf").defaultQueryPort);

declare const fivemPlayer: FiveMPlayer;
expectType<number>(fivemPlayer.id);
expectType<string>(fivemPlayer.name);
expectType<number | undefined>(fivemPlayer.ping);

declare const rustPlayer: RustPlayer;
expectType<string>(rustPlayer.name);
expectType<number>(rustPlayer.durationSeconds);

declare const redmPlayer: RedMPlayer;
expectType<number>(redmPlayer.id);
expectType<string>(redmPlayer.name);
expectType<number | undefined>(redmPlayer.ping);
