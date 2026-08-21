import { GAME_REGISTRY, query } from "queryhost";

const host = process.argv[2];
if (host === undefined) {
  console.error("Usage: node examples/basic.mjs <minecraft-java-host>");
  process.exitCode = 2;
} else {
  const result = await query({
    game: "minecraft-java",
    host,
    timeoutMs: 3_000,
  });

  if (result.ok) {
    console.log(result.server.name ?? "Unnamed server");
    console.log(result.data.motd?.plain ?? "No MOTD reported");
  } else {
    console.error(`${result.error.code}: ${result.error.message}`);
  }

  console.log(`Default Minecraft Java port: ${GAME_REGISTRY["minecraft-java"].defaultPort}`);
}
