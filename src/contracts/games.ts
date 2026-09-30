/** Game-specific public result models connected through the `GameDataMap` contract. */

/** String-valued server rules keyed by their protocol-defined names. */
export type GameRuleMap = Readonly<Record<string, string>>;

/** Untouched protocol data retained separately from normalized game fields. */
export interface A2sRawData {
  /** Exact string-valued map returned by A2S Rules. */
  readonly rules: GameRuleMap;
}

/** One player returned by the generic A2S Player source. */
export interface A2sPlayer {
  readonly index: number;
  readonly name: string;
  readonly score: number;
  readonly durationSeconds: number;
}

/** Protocol facts exposed by the generic Source or GoldSource A2S profile. */
export interface A2sData {
  readonly protocol: number;
  readonly game: string;
  readonly folder: string;
  readonly bots: number;
  readonly serverType: "dedicated" | "listen" | "proxy";
  readonly environment: "linux" | "macos" | "windows";
  readonly vac: boolean;
  /** Present only for modern Source-style Info responses. */
  readonly appId?: number;
  /** Server-advertised tags, when a Source-style Info response provides them. */
  readonly tags?: readonly string[];
  /** Omitted when Player is skipped or unavailable; empty means the server confirmed no players. */
  readonly players?: readonly A2sPlayer[];
}

/** Vintage Story-specific fields disclosed by a server query answer. */
export interface VintageStoryData {
  /** Whether the server returned only stock liveness or the richer status schema. */
  readonly response: "liveness" | "status";
  /** Server message of the day; omitted when the server only confirms liveness. */
  readonly motd?: string;
  /** World play style or game mode advertised by the server. */
  readonly gameMode?: string;
}

/** One player returned by Don't Starve Together's optional Steam A2S Player source. */
export interface DontStarveTogetherPlayer {
  readonly index: number;
  readonly name: string;
  readonly score: number;
  readonly durationSeconds: number;
}

/** Don't Starve Together shard facts reported through its Steam A2S endpoint. */
export interface DontStarveTogetherData {
  readonly protocol: number;
  readonly game: string;
  readonly folder: string;
  readonly bots: number;
  readonly serverType: "dedicated" | "listen" | "proxy";
  readonly environment: "linux" | "macos" | "windows";
  readonly vac: boolean;
  /** Truncated 16-bit App ID carried by the base Source Info layout. */
  readonly appId?: number;
  /** Full 64-bit Steam game ID, encoded as decimal text when the response provides it. */
  readonly steamGameId?: string;
  /** Server-advertised Steam tags, when present. */
  readonly tags?: readonly string[];
  /** Omitted when Player is skipped or unavailable; empty means the shard confirmed no players. */
  readonly players?: readonly DontStarveTogetherPlayer[];
}

/** One player reported by Rust's optional A2S Player source. */
export interface RustPlayer {
  /** Protocol list index supplied by the server. */
  readonly index: number;
  readonly name: string;
  readonly score: number;
  /** Seconds connected, as reported by the server. */
  readonly durationSeconds: number;
}

/** Rust-specific data collected from A2S sources. */
export interface RustData {
  /** Server-advertised tags, when the info response provides them. */
  readonly tags?: readonly string[];
  /** Omitted when Player is skipped or unavailable; empty means the server confirmed no players. */
  readonly players?: readonly RustPlayer[];
}

/** One player returned by Palworld's conditional Steam A2S Player source. */
export interface PalworldPlayer {
  readonly index: number;
  readonly name: string;
  readonly score: number;
  readonly durationSeconds: number;
}

/** Palworld-specific data collected from its public Steam query listener. */
export interface PalworldData {
  /** Server-advertised tags, when the A2S Info response provides them. */
  readonly tags?: readonly string[];
  /** Omitted when Player is skipped or unavailable; empty means the server confirmed no players. */
  readonly players?: readonly PalworldPlayer[];
}

/** Project Zomboid-specific data collected from A2S sources. */
export interface ProjectZomboidData {
  readonly description?: string;
  readonly pvp?: boolean;
  /** Omitted when Rules is unavailable; empty means the server confirmed no mod IDs. */
  readonly mods?: readonly string[];
  /** Omitted when Player is unavailable; empty means the server confirmed no listed players. */
  readonly players?: readonly ProjectZomboidPlayer[];
}

/** One player reported by Project Zomboid's optional A2S Player source. */
export interface ProjectZomboidPlayer {
  readonly index: number;
  readonly name: string;
  readonly score: number;
  readonly durationSeconds: number;
}

/** 7 Days to Die-specific data collected from A2S sources. */
export interface SevenDaysToDieData {
  readonly description?: string;
  readonly gameName?: string;
  readonly gameWorld?: string;
  readonly gameMode?: string;
  /** Raw game clock value advertised by A2S Rules. */
  readonly currentServerTime?: string;
  readonly websiteUrl?: string;
  /** Omitted when Player is unavailable; empty means the server confirmed no listed players. */
  readonly players?: readonly SevenDaysToDiePlayer[];
}

/** One player reported by 7 Days to Die's optional A2S Player source. */
export interface SevenDaysToDiePlayer {
  readonly index: number;
  readonly name: string;
  readonly score: number;
  readonly durationSeconds: number;
}

/** One DayZ mod decoded from the paged server-browser metadata in A2S Rules. */
export interface DayZMod {
  readonly name: string;
  /** Decimal Steam Workshop item ID; omitted when the server advertises zero. */
  readonly workshopId?: string;
  /** Unsigned 32-bit short hash advertised by the server. */
  readonly hash: number;
}

/** Raw direct DayZ Rules retained separately from decoded paged metadata. */
export interface DayZRawData {
  /** Direct string-valued pairs; binary metadata pages are decoded under {@link DayZData}. */
  readonly rules: GameRuleMap;
}

/** DayZ-specific data collected from its Steam A2S endpoint. */
export interface DayZData {
  /** Uninterpreted comma-delimited A2S Info keywords, split in server order. */
  readonly tags?: readonly string[];
  /** Server-browser metadata format version, when paged metadata is available. */
  readonly rulesProtocol?: number;
  readonly description?: string;
  /** Omitted when Rules metadata is unavailable; empty means the server confirmed no mods. */
  readonly mods?: readonly DayZMod[];
  /** Omitted when Rules metadata is unavailable; empty means the server confirmed no keys. */
  readonly signatures?: readonly string[];
  /** Terrain identifier advertised by DayZ's optional Rules response. */
  readonly island?: string;
  /** Operating-system identifier advertised by DayZ's optional Rules response. */
  readonly platform?: "linux" | "windows";
  readonly dedicated?: boolean;
  readonly allowedBuild?: number;
  /** Game connection port advertised by the server; never followed as a query destination. */
  readonly clientPort?: number;
  readonly requiredBuild?: number;
  readonly requiredVersion?: number;
  /** Raw numeric `timeLeft` value reported by DayZ. */
  readonly timeLeft?: number;
  /** Raw numeric language flags reported by DayZ. */
  readonly language?: number;
}

/** One connection record reported by Valheim's optional A2S Player source. */
export interface ValheimPlayer {
  readonly index: number;
  /** Valheim's Steam backend commonly returns an empty name for privacy. */
  readonly name: string;
  readonly score: number;
  readonly durationSeconds: number;
}

/** Valheim-specific data available from its direct Steam-backend A2S endpoint. */
export interface ValheimData {
  /** A successful direct A2S response proves that the queried endpoint uses Steam discovery. */
  readonly backend: "steam";
  /** Game build advertised through Valheim's A2S keyword field, when present. */
  readonly networkVersion?: string;
  /** Omitted when Player is unavailable; empty means the server confirmed no connections. */
  readonly players?: readonly ValheimPlayer[];
}

/** One player reported by a Steam game server's optional A2S Player source. */
export interface SteamA2sPlayer {
  readonly index: number;
  /** Some games, such as Counter-Strike 2, commonly leave names empty for privacy. */
  readonly name: string;
  readonly score: number;
  readonly durationSeconds: number;
}

/** SourceTV relay advertised through a Source-style A2S Info response. */
export interface SourceTvEndpoint {
  /** Port advertised by the server; it may differ from the queried destination. */
  readonly port: number;
  readonly name: string;
}

/** Facts shared by games whose direct Steam A2S endpoint needs no game-specific interpretation. */
export interface SteamA2sData {
  /** Game description advertised by the server, such as a mode, mission, or product name. */
  readonly game: string;
  /** Game content directory, such as `tf` or `garrysmod`, which also identifies Source mods. */
  readonly folder: string;
  readonly bots: number;
  readonly serverType: "dedicated" | "listen" | "proxy";
  readonly environment: "linux" | "macos" | "windows";
  readonly vac: boolean;
  /**
   * Steam App ID for modern Source-style Info responses. It comes from the 64-bit game ID when
   * the server sends one, because the base Info field is 16 bits and truncates larger IDs.
   */
  readonly appId?: number;
  /** Game port the server advertises, which may differ from the queried Steam port. */
  readonly gamePort?: number;
  /** Server's 64-bit Steam ID as decimal text, when advertised. */
  readonly serverSteamId?: string;
  /** Comma-delimited A2S Info keywords split in server order, when present. */
  readonly tags?: readonly string[];
  /** SourceTV relay advertised by the server; never followed as a query destination. */
  readonly sourceTv?: SourceTvEndpoint;
  /** Omitted when Player is skipped or unavailable; empty means the server confirmed no players. */
  readonly players?: readonly SteamA2sPlayer[];
}

/** Counter-Strike 2 data collected from its game-port A2S endpoint. */
export interface CounterStrike2Data extends SteamA2sData {}

/** Counter-Strike: Source data collected from its game-port A2S endpoint. */
export interface CounterStrikeSourceData extends SteamA2sData {}

/** Team Fortress 2 data collected from its game-port A2S endpoint. */
export interface TeamFortress2Data extends SteamA2sData {}

/** Left 4 Dead data collected from its game-port A2S endpoint. */
export interface Left4DeadData extends SteamA2sData {}

/** Left 4 Dead 2 data collected from its game-port A2S endpoint. */
export interface Left4Dead2Data extends SteamA2sData {}

/**
 * Garry's Mod data collected from its game-port A2S endpoint. Its keywords are space-separated
 * `key:value` pairs, so `tags` splits on spaces as well as commas.
 */
export interface GarrysModData extends SteamA2sData {
  /** Active gamemode folder name, such as `sandbox` or `darkrp`, from the `gm` keyword. */
  readonly gamemode?: string;
  /** Steam Workshop item ID of the gamemode, from the `gmws` keyword. */
  readonly gamemodeWorkshopId?: string;
  /** Server-browser category, such as `rp` or `pvp`, from the `gmc` keyword. */
  readonly gamemodeCategory?: string;
  /** Operator-set location code from the `loc` keyword (`sv_location`). */
  readonly location?: string;
  /** Game build date as `YYMMDD`, from the `ver` keyword. */
  readonly build?: string;
}

/** One Steam Workshop mod advertised in an ARK server's `MODn_s` Rules. */
export interface ArkSurvivalEvolvedMod {
  readonly workshopId: string;
  /** Hexadecimal content hash advertised beside the Workshop ID. */
  readonly hash: string;
}

/** ARK: Survival Evolved data collected from its Steam A2S query port. */
export interface ArkSurvivalEvolvedData extends SteamA2sData {
  /** Untruncated server name from `CUSTOMSERVERNAME_s`; ARK sends it lowercased. */
  readonly customServerName?: string;
  readonly pve?: boolean;
  readonly battlEye?: boolean;
  /** Whether Studio Wildcard runs the server. */
  readonly official?: boolean;
  /** Cluster that shares character and item transfers between servers. */
  readonly clusterId?: string;
  /** Game mode class, such as `TestGameMode_C` or a total-conversion mod's mode. */
  readonly gameMode?: string;
  /** In-game time or day count exactly as advertised; its format changed between builds. */
  readonly dayTime?: string;
  readonly allowDownloadCharacters?: boolean;
  readonly allowDownloadItems?: boolean;
  /** Omitted when Rules are unavailable; empty means the server confirmed no active mods. */
  readonly mods?: readonly ArkSurvivalEvolvedMod[];
}

/** Conan Exiles data collected from its Steam A2S query port. */
export interface ConanExilesData extends SteamA2sData {}

/** Killing Floor 2 data collected from its Steam A2S query port. */
export interface KillingFloor2Data extends SteamA2sData {
  /** Game mode name from the `Mode` rule, such as `Survival`. */
  readonly gameMode?: string;
  readonly difficulty?: "normal" | "hard" | "suicidal" | "hell-on-earth";
  /** Wave the match is on; waves are counted from 1. */
  readonly currentWave?: number;
  /** Waves in the match's game length, from the `NumWaves` rule. */
  readonly totalWaves?: number;
  readonly inProgress?: boolean;
  /** Whether the server runs mutators. */
  readonly mutators?: boolean;
  /** Whether the server is custom (unranked) rather than ranked. */
  readonly custom?: boolean;
  readonly spectators?: number;
}

/** Day of Dragons data collected from its Steam A2S query port. */
export interface DayOfDragonsData extends SteamA2sData {}

/** Soulmask data collected from its Steam A2S query port. */
export interface SoulmaskData extends SteamA2sData {}

/** Sons of the Forest data collected from its Steam A2S query port. */
export interface SonsOfTheForestData extends SteamA2sData {}

/** Icarus data collected from its Steam A2S query port. */
export interface IcarusData extends SteamA2sData {}

/** Abiotic Factor data collected from its Steam A2S query port. */
export interface AbioticFactorData extends SteamA2sData {}

/** Arma 3 difficulty settings advertised in its paged server-browser Rules metadata. */
export interface Arma3Difficulty {
  /** Difficulty preset: 0 Recruit, 1 Regular, 2 Veteran, 3 Custom. */
  readonly level: number;
  /** AI skill preset on the same 0 to 3 scale as `level`. */
  readonly aiLevel: number;
  readonly advancedFlightModel: boolean;
  readonly thirdPerson: boolean;
  readonly crosshair: boolean;
}

/** One official Arma 3 DLC the server advertises as required content. */
export interface Arma3Dlc {
  /** Bit set in the server's 16-bit DLC mask. */
  readonly flag: number;
  /** Known DLC name; omitted for a mask bit QueryHost does not recognize. */
  readonly name?: string;
  /** Steam App ID of a recognized DLC. */
  readonly appId?: number;
  /** Unsigned 32-bit short hash advertised by the server. */
  readonly hash: number;
}

/** One Arma 3 Creator DLC loaded by the server. */
export interface Arma3CreatorDlc {
  readonly appId: number;
  /** Known Creator DLC name; omitted for an unrecognized App ID. */
  readonly name?: string;
  readonly hash: number;
}

/** One Arma 3 mod decoded from the paged server-browser Rules metadata. */
export interface Arma3Mod {
  readonly name: string;
  /** Decimal Steam Workshop item ID; omitted for a local mod, which advertises zero. */
  readonly workshopId?: string;
  /** Unsigned 32-bit short hash advertised by the server. */
  readonly hash: number;
}

/** Raw direct Arma 3 Rules retained separately from decoded paged metadata. */
export interface Arma3RawData {
  /** Direct string-valued pairs; binary metadata pages are decoded under {@link Arma3Data}. */
  readonly rules: GameRuleMap;
}

/** Arma 3 data collected from its Steam A2S query port. */
export interface Arma3Data extends SteamA2sData {
  /** Whether BattlEye protection is enabled, from the `b` keyword. */
  readonly battlEye?: boolean;
  /** Game version clients must run, from the `r` keyword (for example 218 for 2.18). */
  readonly requiredVersion?: number;
  /** Game build number clients must run, from the `n` keyword. */
  readonly requiredBuild?: number;
  /** Bohemia session state from the `s` keyword: 0 none through 7 playing, 8 finished, 9 aborted. */
  readonly serverState?: number;
  /** Mission game type from the `t` keyword, such as `coop`, `zeus`, or `warlord`. */
  readonly gameType?: string;
  /** Whether clients must load exactly the server's mods, from the `m` keyword. */
  readonly equalModsRequired?: boolean;
  /** Whether the session is locked against new players, from the `l` keyword. */
  readonly locked?: boolean;
  /** Whether the server verifies addon signatures, from the `v` keyword. */
  readonly verifySignatures?: boolean;
  /** Whether the server is dedicated, from the `d` keyword. */
  readonly dedicated?: boolean;
  /** Whether file patching is allowed, from the `f` keyword. */
  readonly filePatching?: boolean;
  /** Server operating system from the `p` keyword. */
  readonly platform?: "linux" | "macos" | "windows";
  /** Raw Bohemia language code from the `g` keyword, such as 65545 for English. */
  readonly language?: number;
  /** Country code from the `o` keyword. */
  readonly country?: string;
  /** Mission time remaining in minutes, from the `e` keyword. */
  readonly timeLeftMinutes?: number;
  /** Island identifier from the `y` keyword. */
  readonly island?: string;
  /** Loaded-content hash from the `h` keyword. */
  readonly loadedContentHash?: string;
  /** Server-browser metadata format version, when paged Rules metadata is available. */
  readonly rulesProtocol?: number;
  /** Omitted when Rules metadata is unavailable or the server advertises no difficulty. */
  readonly difficulty?: Arma3Difficulty;
  /** Omitted when Rules metadata is unavailable; empty means the server requires no DLC. */
  readonly dlc?: readonly Arma3Dlc[];
  /** Omitted when Rules metadata is unavailable; empty means no Creator DLC is loaded. */
  readonly creatorDlc?: readonly Arma3CreatorDlc[];
  /** Omitted when Rules metadata is unavailable; empty means the server confirmed no mods. */
  readonly mods?: readonly Arma3Mod[];
  /** Accepted signature key names; empty means the server confirmed none. */
  readonly signatures?: readonly string[];
  /** Optional description appended to the metadata by some server builds. */
  readonly description?: string;
}

/** American Truck Simulator data collected from its Steam A2S query port. */
export interface AmericanTruckSimulatorData extends SteamA2sData {}

/** Euro Truck Simulator 2 data collected from its Steam A2S query port. */
export interface EuroTruckSimulator2Data extends SteamA2sData {}

/** The Forest data collected from its Steam A2S query port. */
export interface TheForestData extends SteamA2sData {}

/** One server-browser link advertised by an Unturned server. */
export interface UnturnedLink {
  readonly message: string;
  readonly url: string;
}

/** Unturned data collected from its Steam A2S query port. */
export interface UnturnedData extends SteamA2sData {
  /** Whether players can damage each other; `false` means PvE. */
  readonly pvp?: boolean;
  readonly cheats?: boolean;
  readonly difficulty?: "easy" | "normal" | "hard";
  readonly cameraMode?: "first-person" | "both" | "third-person" | "vehicle";
  /** Whether the server requires Steam Workshop content. */
  readonly workshop?: boolean;
  /** Whether only Unturned Gold players may join. */
  readonly goldOnly?: boolean;
  /** Whether the host declares an anycast proxy in front of the server. */
  readonly anycastProxy?: boolean;
  readonly battlEye?: boolean;
  /** Host-declared monetization; omitted when the server leaves it unspecified. */
  readonly monetization?: "none" | "non-gameplay" | "monetized";
  readonly thumbnailUrl?: string;
  /** Network transport tag, such as `def`, `sys`, or `sns`. */
  readonly networkTransport?: string;
  readonly pluginFramework?: "rocketmod" | "openmod";
  /** Unturned build the server runs, from the `GameVersion` rule. */
  readonly gameVersion?: string;
  /** Name and version of a server-side mod module, when one is loaded. */
  readonly modName?: string;
  readonly modVersion?: string;
  readonly iconUrl?: string;
  /** Short hint shown beside the server-list description. */
  readonly descriptionHint?: string;
  readonly bookmarkHost?: string;
  /** Full server-browser description, decoded from its Base64 chunks. */
  readonly description?: string;
  /** Required Steam Workshop item IDs; omitted when Rules are unavailable or list none. */
  readonly workshopIds?: readonly string[];
  readonly links?: readonly UnturnedLink[];
  /** Gameplay settings changed from the mode defaults, keyed `Section.Field`. */
  readonly config?: Readonly<Record<string, boolean | number>>;
  /** Loaded RocketMod plugin names. */
  readonly plugins?: readonly string[];
}

/** Enshrouded data collected from its Steam A2S query port. */
export interface EnshroudedData extends SteamA2sData {}

/** Insurgency: Sandstorm data collected from its Steam A2S query port. */
export interface InsurgencySandstormData extends SteamA2sData {}

/** Normalized Minecraft message-of-the-day representations. */
export interface MinecraftMotd {
  /** Formatting-free text suitable for logs and plain interfaces. */
  readonly plain: string;
  /** Sanitized formatted output, when the source can be represented safely. */
  readonly html?: string;
}

/** Software identity advertised by a Minecraft server or proxy. */
export interface MinecraftSoftware {
  readonly name?: string;
  readonly version?: string;
}

/** One plugin advertised through the optional Minecraft Query protocol. */
export interface MinecraftPlugin {
  readonly name: string;
  readonly version?: string;
}

/** The DNS SRV destination selected for a Minecraft Java query. */
export interface MinecraftSrvTarget {
  readonly host: string;
  readonly port: number;
}

/** Minecraft Java data merged from Server List Ping and optional Query/SRV sources. */
export interface MinecraftJavaData {
  readonly motd?: MinecraftMotd;
  /** Numeric protocol version, distinct from the human-readable server version. */
  readonly protocolVersion?: number;
  /** Validated data URL for the server icon, subject to a strict size limit. */
  readonly favicon?: string;
  readonly software?: MinecraftSoftware;
  /** Omitted when the Query source is disabled, unavailable, or does not advertise plugins. */
  readonly plugins?: readonly MinecraftPlugin[];
  /** Omitted when Query is skipped or unavailable; empty means Query confirmed no listed players. */
  readonly players?: readonly string[];
  readonly srv?: MinecraftSrvTarget;
}

/** Minecraft Bedrock data parsed from a RakNet unconnected pong. */
export interface MinecraftBedrockData {
  readonly edition?: string;
  readonly motd?: string;
  readonly protocolVersion?: number;
  readonly gameMode?: string;
  readonly serverId?: string;
  /** Port advertised by the server; it may differ from the queried destination. */
  readonly advertisedIpv4Port?: number;
  /** IPv6 port advertised by the server, when present. */
  readonly advertisedIpv6Port?: number;
}

/** One player reported by a Cfx FXServer fixed players endpoint. */
export interface CfxPlayer {
  readonly id: number;
  readonly name: string;
  readonly ping?: number;
}

/** Data shared by Cfx FXServer games and merged from their fixed JSON endpoints. */
export interface CfxData<P extends CfxPlayer = CfxPlayer> {
  /** Omitted when the resources endpoint is unavailable; an empty array means confirmed empty. */
  readonly resources?: readonly string[];
  readonly variables?: Readonly<Record<string, string>>;
  /** Omitted when the players endpoint is unavailable; an empty array means confirmed empty. */
  readonly players?: readonly P[];
  readonly gameType?: string;
  readonly oneSyncEnabled?: boolean;
  readonly enhancedHostSupport?: boolean;
}

/** One player reported by FiveM's fixed players endpoint. */
export interface FiveMPlayer extends CfxPlayer {}

/** FiveM-specific data merged from its fixed JSON endpoints. */
export interface FiveMData extends CfxData<FiveMPlayer> {}

/** One player reported by RedM's fixed players endpoint. */
export interface RedMPlayer extends CfxPlayer {}

/** RedM-specific data merged from its fixed JSON endpoints. */
export interface RedMData extends CfxData<RedMPlayer> {}

/** Lifecycle state returned by Satisfactory's lightweight status service. */
export type SatisfactoryServerState = "idle" | "loading" | "playing";

/** One recognized Satisfactory subsystem revision counter. */
export interface SatisfactorySubState {
  /** Protocol-defined subsystem ID from 0 through 7. */
  readonly id: number;
  readonly version: number;
}

/** Health data returned by the credential-free HTTPS HealthCheck function. */
export interface SatisfactoryHealth {
  readonly health: "healthy" | "slow";
  /** Empty means the vanilla server confirmed that it supplied no custom data. */
  readonly serverCustomData: string;
}

/** Satisfactory-specific facts from its dedicated-server status APIs. */
export interface SatisfactoryData {
  readonly state: SatisfactoryServerState;
  /** Dedicated server network changelist. */
  readonly serverNetCl: number;
  readonly modded: boolean;
  /** Omitted in summary mode, while loading, or when the optional HTTPS source fails. */
  readonly health?: SatisfactoryHealth["health"];
}

/** Parsed protocol fields retained separately from normalized Satisfactory data. */
export interface SatisfactoryRawData {
  readonly stateCode: 1 | 2 | 3;
  readonly serverFlags: string;
  readonly subStates: readonly SatisfactorySubState[];
  /** Omitted when the optional HTTPS source did not complete. */
  readonly health?: SatisfactoryHealth;
}
