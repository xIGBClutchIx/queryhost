/** Bounded Minecraft chat-component and legacy-format MOTD normalization. */

import type { MinecraftMotd } from "../../games.js";
import { failMinecraftJava } from "./errors.js";
import { isJsonArray, isJsonObject, type JsonObject, type JsonValue } from "./json.js";

const MAX_COMPONENT_DEPTH = 16;
const MAX_COMPONENT_NODES = 1_024;
const MAX_MOTD_CHARACTERS = 32_767;

const NAMED_COLORS: Readonly<Record<string, string>> = Object.freeze({
  black: "#000000",
  dark_blue: "#0000aa",
  dark_green: "#00aa00",
  dark_aqua: "#00aaaa",
  dark_red: "#aa0000",
  dark_purple: "#aa00aa",
  gold: "#ffaa00",
  gray: "#aaaaaa",
  dark_gray: "#555555",
  blue: "#5555ff",
  green: "#55ff55",
  aqua: "#55ffff",
  red: "#ff5555",
  light_purple: "#ff55ff",
  yellow: "#ffff55",
  white: "#ffffff",
});

const LEGACY_COLORS: Readonly<Record<string, string>> = Object.freeze({
  "0": "#000000",
  "1": "#0000aa",
  "2": "#00aa00",
  "3": "#00aaaa",
  "4": "#aa0000",
  "5": "#aa00aa",
  "6": "#ffaa00",
  "7": "#aaaaaa",
  "8": "#555555",
  "9": "#5555ff",
  a: "#55ff55",
  b: "#55ffff",
  c: "#ff5555",
  d: "#ff55ff",
  e: "#ffff55",
  f: "#ffffff",
});

interface TextStyle {
  readonly color?: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underlined: boolean;
  readonly strikethrough: boolean;
  readonly obfuscated: boolean;
}

interface TextSegment {
  readonly text: string;
  readonly style: TextStyle;
}

interface WalkState {
  nodes: number;
  characters: number;
}

const EMPTY_STYLE: TextStyle = Object.freeze({
  bold: false,
  italic: false,
  underlined: false,
  strikethrough: false,
  obfuscated: false,
});

function booleanStyle(object: JsonObject, key: string, inherited: boolean): boolean {
  const value = object[key];
  if (value === undefined) {
    return inherited;
  }
  if (typeof value !== "boolean") {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  return value;
}

function colorStyle(object: JsonObject, inherited: string | undefined): string | undefined {
  const value = object["color"];
  if (value === undefined) {
    return inherited;
  }
  if (typeof value !== "string") {
    return failMinecraftJava("MALFORMED_RESPONSE");
  }
  if (value === "reset") {
    return undefined;
  }
  const named = NAMED_COLORS[value];
  if (named !== undefined) {
    return named;
  }
  if (/^#[0-9a-f]{6}$/iu.test(value)) {
    return value.toLowerCase();
  }
  return failMinecraftJava("MALFORMED_RESPONSE");
}

function componentStyle(object: JsonObject, inherited: TextStyle): TextStyle {
  const color = colorStyle(object, inherited.color);
  return Object.freeze({
    ...(color === undefined ? {} : { color }),
    bold: booleanStyle(object, "bold", inherited.bold),
    italic: booleanStyle(object, "italic", inherited.italic),
    underlined: booleanStyle(object, "underlined", inherited.underlined),
    strikethrough: booleanStyle(object, "strikethrough", inherited.strikethrough),
    obfuscated: booleanStyle(object, "obfuscated", inherited.obfuscated),
  });
}

function sameStyle(left: TextStyle, right: TextStyle): boolean {
  return (
    left.color === right.color &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.underlined === right.underlined &&
    left.strikethrough === right.strikethrough &&
    left.obfuscated === right.obfuscated
  );
}

function appendSegment(
  segments: TextSegment[],
  text: string,
  style: TextStyle,
  state: WalkState,
): void {
  if (text.length === 0) {
    return;
  }
  state.characters += text.length;
  if (state.characters > MAX_MOTD_CHARACTERS) {
    failMinecraftJava("RESPONSE_TOO_LARGE");
  }
  const previous = segments.at(-1);
  if (previous !== undefined && sameStyle(previous.style, style)) {
    segments[segments.length - 1] = { text: previous.text + text, style };
  } else {
    segments.push({ text, style });
  }
}

function legacyHex(
  text: string,
  offset: number,
): { readonly color: string; readonly end: number } | undefined {
  if (text[offset]?.toLowerCase() !== "x") {
    return undefined;
  }
  let hex = "";
  let cursor = offset + 1;
  for (let index = 0; index < 6; index += 1) {
    if (text[cursor] !== "§") {
      return undefined;
    }
    const digit = text[cursor + 1];
    if (digit === undefined || !/^[0-9a-f]$/iu.test(digit)) {
      return undefined;
    }
    hex += digit;
    cursor += 2;
  }
  return { color: `#${hex.toLowerCase()}`, end: cursor };
}

function legacySegments(
  text: string,
  inherited: TextStyle,
  segments: TextSegment[],
  state: WalkState,
): void {
  let style = inherited;
  let plain = "";
  const flush = (): void => {
    appendSegment(segments, plain, style, state);
    plain = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (character !== "§" || index + 1 >= text.length) {
      plain += character;
      continue;
    }
    const code = text[index + 1]?.toLowerCase();
    if (code === undefined) {
      plain += character;
      continue;
    }
    const hex = legacyHex(text, index + 1);
    if (hex !== undefined) {
      flush();
      style = { ...EMPTY_STYLE, color: hex.color };
      index = hex.end - 1;
      continue;
    }
    const color = LEGACY_COLORS[code];
    if (color !== undefined) {
      flush();
      style = { ...EMPTY_STYLE, color };
      index += 1;
    } else if (code === "k" || code === "l" || code === "m" || code === "n" || code === "o") {
      flush();
      style = {
        ...style,
        ...(code === "k" ? { obfuscated: true } : {}),
        ...(code === "l" ? { bold: true } : {}),
        ...(code === "m" ? { strikethrough: true } : {}),
        ...(code === "n" ? { underlined: true } : {}),
        ...(code === "o" ? { italic: true } : {}),
      };
      index += 1;
    } else if (code === "r") {
      flush();
      style = EMPTY_STYLE;
      index += 1;
    } else {
      plain += character;
    }
  }
  flush();
}

function componentText(object: JsonObject): string {
  for (const key of ["text", "translate", "keybind", "selector"] as const) {
    const value = object[key];
    if (value !== undefined) {
      if (typeof value !== "string") {
        return failMinecraftJava("MALFORMED_RESPONSE");
      }
      return value;
    }
  }
  return failMinecraftJava("MALFORMED_RESPONSE");
}

function walkComponent(
  value: JsonValue,
  inherited: TextStyle,
  depth: number,
  segments: TextSegment[],
  state: WalkState,
): void {
  state.nodes += 1;
  if (depth > MAX_COMPONENT_DEPTH || state.nodes > MAX_COMPONENT_NODES) {
    failMinecraftJava("RESPONSE_TOO_LARGE");
  }
  if (typeof value === "string") {
    legacySegments(value, inherited, segments, state);
    return;
  }
  if (isJsonArray(value)) {
    for (const child of value) {
      walkComponent(child, inherited, depth + 1, segments, state);
    }
    return;
  }
  if (!isJsonObject(value)) {
    failMinecraftJava("MALFORMED_RESPONSE");
  }
  const style = componentStyle(value, inherited);
  legacySegments(componentText(value), style, segments, state);

  const withValues = value["with"];
  if (withValues !== undefined) {
    if (!isJsonArray(withValues)) {
      failMinecraftJava("MALFORMED_RESPONSE");
    }
    for (const child of withValues) {
      walkComponent(child, style, depth + 1, segments, state);
    }
  }
  const extra = value["extra"];
  if (extra !== undefined) {
    if (!isJsonArray(extra)) {
      failMinecraftJava("MALFORMED_RESPONSE");
    }
    for (const child of extra) {
      walkComponent(child, style, depth + 1, segments, state);
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("\n", "<br>");
}

function segmentHtml(segment: TextSegment): string {
  const declarations: string[] = [];
  if (segment.style.color !== undefined) {
    declarations.push(`color:${segment.style.color}`);
  }
  if (segment.style.bold) {
    declarations.push("font-weight:bold");
  }
  if (segment.style.italic) {
    declarations.push("font-style:italic");
  }
  const decorations: string[] = [];
  if (segment.style.underlined) {
    decorations.push("underline");
  }
  if (segment.style.strikethrough) {
    decorations.push("line-through");
  }
  if (decorations.length > 0) {
    declarations.push(`text-decoration:${decorations.join(" ")}`);
  }
  if (segment.style.obfuscated) {
    declarations.push("filter:blur(0.25em)");
  }
  const escaped = escapeHtml(segment.text);
  return declarations.length === 0
    ? escaped
    : `<span style="${declarations.join(";")}">${escaped}</span>`;
}

/** Converts one bounded status description into plain text and fixed-whitelist HTML. */
export function normalizeMinecraftMotd(description: JsonValue): MinecraftMotd {
  const segments: TextSegment[] = [];
  walkComponent(description, EMPTY_STYLE, 0, segments, { nodes: 0, characters: 0 });
  const plain = segments.map((segment) => segment.text).join("");
  const html = segments.map(segmentHtml).join("");
  return Object.freeze({ plain, html });
}
