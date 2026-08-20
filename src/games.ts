/** Game-specific result models connected through the public `GameDataMap` contract. */

/** String-valued server rules keyed by their protocol-defined names. */
export type GameRuleMap = Readonly<Record<string, string>>;

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
  /** Raw A2S rules that remain meaningful to Rust consumers. */
  readonly rules?: GameRuleMap;
}

/** Project Zomboid-specific data collected from A2S sources. */
export interface ProjectZomboidData {
  readonly rules?: GameRuleMap;
}

/** 7 Days to Die-specific data collected from A2S sources. */
export interface SevenDaysToDieData {
  readonly rules?: GameRuleMap;
}

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

/** One player reported by FiveM's fixed players endpoint. */
export interface FiveMPlayer {
  readonly id: number;
  readonly name: string;
  readonly ping?: number;
}

/** FiveM-specific data merged from its fixed JSON endpoints. */
export interface FiveMData {
  /** Omitted when the resources endpoint is unavailable; an empty array means confirmed empty. */
  readonly resources?: readonly string[];
  readonly variables?: Readonly<Record<string, string>>;
  /** Omitted when the players endpoint is unavailable; an empty array means confirmed empty. */
  readonly players?: readonly FiveMPlayer[];
  readonly oneSyncEnabled?: boolean;
  readonly enhancedHostSupport?: boolean;
}
