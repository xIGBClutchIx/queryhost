import {
  GAME_REGISTRY,
  query,
  type FiveMData,
  type QueryResult,
  type RedMData,
  type RustData,
  type VintageStoryData,
} from "queryhost";

const rustQuery: Promise<QueryResult<"rust">> = query({
  game: "rust",
  host: "play.example.com",
});

declare const rustData: RustData;
declare const fivemData: FiveMData;
declare const redmData: RedMData;
declare const vintageStoryData: VintageStoryData;

rustData.tags satisfies readonly string[] | undefined;
fivemData.players?.[0]?.name satisfies string | undefined;
redmData.players?.[0]?.name satisfies string | undefined;
GAME_REGISTRY.fivem.defaultPort satisfies number | undefined;
GAME_REGISTRY.redm.defaultPort satisfies number | undefined;
vintageStoryData.response satisfies "liveness" | "status";
GAME_REGISTRY["vintage-story"].defaultPort satisfies number | undefined;
void rustQuery;
