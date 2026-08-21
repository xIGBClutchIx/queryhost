import { query, type QueryResult } from "queryhost";

export async function queryRustServer(host: string): Promise<QueryResult<"rust">> {
  const result = await query({ game: "rust", host });

  if (result.ok) {
    console.log(result.data.tags);
    console.log(result.data.players?.map((player) => player.name));
  }

  return result;
}
