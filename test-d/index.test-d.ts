import { expectAssignable, expectError, expectNotAssignable, expectType } from "tsd";

import {
  GAME_IDS,
  QUERYHOST_NAME,
  getGameDefinition,
  isGameId,
  type FiveMData,
  type GameDataMap,
  type GameId,
  type MinecraftBedrockData,
  type MinecraftJavaData,
  type ProjectZomboidData,
  type QueryError,
  type QueryInput,
  type QueryResult,
  type QuerySourceStatus,
  type RustData,
  type SevenDaysToDieData,
} from "queryhost";

expectType<"queryhost">(QUERYHOST_NAME);
expectAssignable<QuerySourceStatus>("failed");
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
expectNotAssignable<QueryInput>({ game: "counter-strike", host: "play.example.com" });

expectType<"rust">(getGameDefinition("rust").id);
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
expectType<MinecraftJavaData>(dataMap["minecraft-java"]);
