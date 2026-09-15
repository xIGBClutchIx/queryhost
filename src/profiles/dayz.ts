/** DayZ-specific interpretation over reusable A2S Info and Rules sources. */

import type { DayZData, GameRuleMap } from "../contracts/games.js";
import type { QuerySource, QueryWarning, ServerInfo } from "../contracts/shared.js";
import type { A2sRules } from "../protocols/a2s/rules.js";
import { dayZRuleMetadata, queryDayZRules } from "../protocols/dayz/rules.js";
import {
  a2sProfileWarnings,
  a2sServerInfo,
  queryA2sProfile,
  type A2sProfileOptions,
} from "./a2s.js";

/** Inputs available after the public query layer pins a DayZ Steam query destination. */
export type DayZProfileOptions = A2sProfileOptions;

/** Fully merged DayZ result before the public query envelope is added. */
export interface DayZProfileResult {
  readonly server: ServerInfo;
  readonly data: DayZData;
  readonly rawData?: { readonly rules: GameRuleMap };
  readonly sources: readonly [QuerySource, QuerySource, QuerySource];
  readonly warnings: readonly QueryWarning[];
  readonly partial: boolean;
}

function tags(value: string): readonly string[] {
  return Object.freeze(
    value
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0),
  );
}

function booleanRule(value: string | undefined): boolean | undefined {
  if (value === "1") {
    return true;
  }
  if (value === "0") {
    return false;
  }
  return undefined;
}

function unsignedRule(value: string | undefined, maximum: number): number | undefined {
  if (value === undefined || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : undefined;
}

function portRule(value: string | undefined): number | undefined {
  const port = unsignedRule(value, 65_535);
  return port === 0 ? undefined : port;
}

function platformRule(value: string | undefined): "linux" | "windows" | undefined {
  if (value === "win") {
    return "windows";
  }
  if (value === "lin") {
    return "linux";
  }
  return undefined;
}

function dayZData(keywords: string | undefined, rules: A2sRules | undefined): DayZData {
  const metadata = rules === undefined ? undefined : dayZRuleMetadata(rules);
  const island = rules?.["island"];
  const platform = platformRule(rules?.["platform"]);
  const dedicated = booleanRule(rules?.["dedicated"]);
  const allowedBuild = unsignedRule(rules?.["allowedBuild"], 65_535);
  const clientPort = portRule(rules?.["clientPort"]);
  const requiredBuild = unsignedRule(rules?.["requiredBuild"], 65_535);
  const requiredVersion = unsignedRule(rules?.["requiredVersion"], 65_535);
  const timeLeft = unsignedRule(rules?.["timeLeft"], 65_535);
  const language = unsignedRule(rules?.["language"], 4_294_967_295);
  return Object.freeze({
    ...(keywords === undefined ? {} : { tags: tags(keywords) }),
    ...(metadata === undefined
      ? {}
      : {
          rulesProtocol: metadata.protocol,
          ...(metadata.description === undefined ? {} : { description: metadata.description }),
          mods: metadata.mods,
          signatures: metadata.signatures,
        }),
    ...(island === undefined ? {} : { island }),
    ...(platform === undefined ? {} : { platform }),
    ...(dedicated === undefined ? {} : { dedicated }),
    ...(allowedBuild === undefined ? {} : { allowedBuild }),
    ...(clientPort === undefined ? {} : { clientPort }),
    ...(requiredBuild === undefined ? {} : { requiredBuild }),
    ...(requiredVersion === undefined ? {} : { requiredVersion }),
    ...(timeLeft === undefined ? {} : { timeLeft }),
    ...(language === undefined ? {} : { language }),
  });
}

/** Queries DayZ Info and Rules while explicitly not requesting its unusable Player listing. */
export async function queryDayZProfile(options: DayZProfileOptions): Promise<DayZProfileResult> {
  const result = await queryA2sProfile({
    ...options,
    playerPolicy: "unsupported",
    queryRules: queryDayZRules,
  });
  const optionalWarnings = a2sProfileWarnings("DayZ", result.optional.sources);
  const info = result.info.info;
  return Object.freeze({
    server: a2sServerInfo(result.info),
    data: dayZData(info.format === "source" ? info.keywords : undefined, result.optional.rules),
    ...(result.optional.rules === undefined
      ? {}
      : { rawData: Object.freeze({ rules: result.optional.rules }) }),
    sources: result.sources,
    warnings: optionalWarnings,
    partial: optionalWarnings.length > 0,
  });
}
