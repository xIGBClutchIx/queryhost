import {
  GAME_REGISTRY,
  query,
  type DontStarveTogetherData,
  type FiveMData,
  type QueryResult,
  type RustData,
} from "queryhost";

const rustQuery: Promise<QueryResult<"rust">> = query({
  game: "rust",
  host: "play.example.com",
});

declare const rustData: RustData;
declare const fivemData: FiveMData;
declare const dstData: DontStarveTogetherData;

rustData.tags satisfies readonly string[] | undefined;
fivemData.players?.[0]?.name satisfies string | undefined;
dstData.steamGameId satisfies string | undefined;
GAME_REGISTRY["dont-starve-together"].defaultQueryPort satisfies number | undefined;
GAME_REGISTRY.fivem.defaultPort satisfies number | undefined;
void rustQuery;
