import { expectError, expectNotAssignable, expectType } from "tsd";

import {
  GAME_IDS,
  getGameDefinition,
  isGameId,
  query,
  type FiveMData,
  type GameDataMap,
  type GameId,
  type MinecraftBedrockData,
  type MinecraftJavaData,
  type ProjectZomboidData,
  type ProjectZomboidPlayer,
  type QueryError,
  type QueryInput,
  type QueryResult,
  type RustData,
  type RustPlayer,
  type SevenDaysToDieData,
  type SevenDaysToDiePlayer,
} from "queryhost";

expectType<
  readonly [
    "rust",
    "project-zomboid",
    "7-days-to-die",
    "minecraft-java",
    "minecraft-bedrock",
    "fivem",
  ]
>(GAME_IDS);

const rustInput: QueryInput<"rust"> = {
  game: "rust",
  host: "play.example.com",
  mode: "full",
};
expectType<"rust">(rustInput.game);
expectType<Promise<QueryResult<"rust">>>(query(rustInput));
expectType<Promise<QueryResult<"project-zomboid">>>(
  query({ game: "project-zomboid", host: "play.example.com" }),
);
expectType<Promise<QueryResult<"7-days-to-die">>>(
  query({ game: "7-days-to-die", host: "play.example.com" }),
);
expectNotAssignable<QueryInput>({ game: "counter-strike", host: "play.example.com" });

declare const dynamicInput: QueryInput;
expectType<Promise<QueryResult>>(query(dynamicInput));

expectType<"rust">(getGameDefinition("rust").id);
expectType<number | undefined>(getGameDefinition("rust").defaultQueryPort);
expectType<number>(getGameDefinition("minecraft-java").defaultPort);

declare const candidate: string;
if (isGameId(candidate)) {
  expectType<GameId>(candidate);
}

declare const rustResult: QueryResult<"rust">;
if (rustResult.ok) {
  expectType<RustData>(rustResult.data);
} else {
  expectType<QueryError>(rustResult.error);
  expectError(rustResult.data);
}

declare const dynamicResult: QueryResult;
if (dynamicResult.ok) {
  switch (dynamicResult.game) {
    case "rust":
      expectType<RustData>(dynamicResult.data);
      break;
    case "project-zomboid":
      expectType<ProjectZomboidData>(dynamicResult.data);
      break;
    case "7-days-to-die":
      expectType<SevenDaysToDieData>(dynamicResult.data);
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
  }
} else {
  expectType<QueryError>(dynamicResult.error);
  expectError(dynamicResult.data);
}

declare const dataMap: GameDataMap;
expectType<RustData>(dataMap.rust);
expectType<readonly RustPlayer[] | undefined>(dataMap.rust.players);
expectType<readonly ProjectZomboidPlayer[] | undefined>(dataMap["project-zomboid"].players);
expectType<readonly string[] | undefined>(dataMap["project-zomboid"].mods);
expectType<readonly SevenDaysToDiePlayer[] | undefined>(dataMap["7-days-to-die"].players);
expectType<string | undefined>(dataMap["7-days-to-die"].currentServerTime);
expectType<MinecraftJavaData>(dataMap["minecraft-java"]);

declare const rustPlayer: RustPlayer;
expectType<string>(rustPlayer.name);
expectType<number>(rustPlayer.durationSeconds);
