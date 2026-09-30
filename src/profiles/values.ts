/** Strict conversions for server-advertised text values; each returns `undefined` when invalid. */

const UINT32_MAX = 4_294_967_295;

/** Parses a canonical unsigned decimal integer no greater than `maximum`. */
export function unsignedValue(
  value: string | undefined,
  maximum: number = UINT32_MAX,
): number | undefined {
  if (value === undefined || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return parsed <= maximum ? parsed : undefined;
}

/** Parses a signed decimal integer within the 32-bit range. */
export function integerValue(value: string | undefined): number | undefined {
  if (value === undefined || !/^-?(?:0|[1-9]\d*)$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return parsed >= -2_147_483_648 && parsed <= 2_147_483_647 ? parsed : undefined;
}

/** Parses a finite decimal number such as `120.000000`. */
export function decimalValue(value: string | undefined): number | undefined {
  if (value === undefined || !/^-?\d+(?:\.\d+)?$/u.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Maps a value to `true` or `false` using the spellings a game documents; others are unknown. */
export function booleanValue(
  value: string | undefined,
  truthy: readonly string[],
  falsy: readonly string[],
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (truthy.includes(value)) {
    return true;
  }
  return falsy.includes(value) ? false : undefined;
}

/** Returns non-empty text unchanged. */
export function textValue(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

/** Splits comma-delimited text into trimmed, non-empty items. */
export function listValue(value: string): readonly string[] {
  return Object.freeze(
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
}

/** Returns `{ [key]: value }` when the value is present, so spreads keep omitted fields absent. */
export function optionalField<K extends string, V>(
  key: K,
  value: V | undefined,
): { readonly [P in K]?: V } {
  if (value === undefined) {
    return {};
  }
  const field: { [P in K]?: V } = {};
  field[key] = value;
  return field;
}
