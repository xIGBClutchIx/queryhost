export type GameRuleMap = Readonly<Record<string, string>>;

export interface RustData {
  readonly tags?: readonly string[];
  readonly rules?: GameRuleMap;
}

export interface ProjectZomboidData {
  readonly rules?: GameRuleMap;
}

export interface SevenDaysToDieData {
  readonly rules?: GameRuleMap;
}

export interface MinecraftMotd {
  readonly plain: string;
  readonly html?: string;
}

export interface MinecraftSoftware {
  readonly name?: string;
  readonly version?: string;
}

export interface MinecraftPlugin {
  readonly name: string;
  readonly version?: string;
}

export interface MinecraftSrvTarget {
  readonly host: string;
  readonly port: number;
}

export interface MinecraftJavaData {
  readonly motd?: MinecraftMotd;
  readonly protocolVersion?: number;
  readonly favicon?: string;
  readonly software?: MinecraftSoftware;
  readonly plugins?: readonly MinecraftPlugin[];
  readonly srv?: MinecraftSrvTarget;
}

export interface MinecraftBedrockData {
  readonly edition?: string;
  readonly motd?: string;
  readonly protocolVersion?: number;
  readonly gameMode?: string;
  readonly serverId?: string;
  readonly advertisedIpv4Port?: number;
  readonly advertisedIpv6Port?: number;
}

export interface FiveMPlayer {
  readonly id: number;
  readonly name: string;
  readonly ping?: number;
}

export interface FiveMData {
  readonly resources?: readonly string[];
  readonly variables?: Readonly<Record<string, string>>;
  readonly players?: readonly FiveMPlayer[];
  readonly oneSyncEnabled?: boolean;
  readonly enhancedHostSupport?: boolean;
}
