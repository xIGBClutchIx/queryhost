/** Shared JSON value domain and structural budget for protocols that parse JSON documents. */

/** Any value `JSON.parse` can produce. */
export type JsonValue = boolean | null | number | string | JsonValue[] | JsonObject;

/** A parsed JSON object. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** Structural limits checked before a protocol reads any field of a parsed document. */
export interface JsonBudget {
  /** Deepest nesting allowed; the root value is depth 0. */
  readonly maxDepth: number;
  /** Total values allowed, counting every container and primitive. */
  readonly maxNodes: number;
  /** Most entries allowed in one array or object. */
  readonly maxCollectionItems?: number;
  /** Longest object key allowed, in UTF-16 code units. */
  readonly maxKeyLength?: number;
  /** Longest string value allowed, in UTF-16 code units. */
  readonly maxStringLength?: number;
}

/** Narrows one JSON value to a non-array object. */
export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reports whether a parsed document stays within the budget. Depth is checked before descending,
 * so recursion never exceeds `maxDepth + 1` frames however deeply the input nests.
 */
export function withinJsonBudget(value: JsonValue, budget: JsonBudget): boolean {
  let nodes = 0;
  const visit = (current: JsonValue, depth: number): boolean => {
    nodes += 1;
    if (nodes > budget.maxNodes || depth > budget.maxDepth) {
      return false;
    }
    if (Array.isArray(current)) {
      if (budget.maxCollectionItems !== undefined && current.length > budget.maxCollectionItems) {
        return false;
      }
      return current.every((entry) => visit(entry, depth + 1));
    }
    if (isJsonObject(current)) {
      const entries = Object.entries(current);
      if (budget.maxCollectionItems !== undefined && entries.length > budget.maxCollectionItems) {
        return false;
      }
      return entries.every(
        ([key, entry]) =>
          (budget.maxKeyLength === undefined || key.length <= budget.maxKeyLength) &&
          visit(entry, depth + 1),
      );
    }
    return (
      typeof current !== "string" ||
      budget.maxStringLength === undefined ||
      current.length <= budget.maxStringLength
    );
  };
  return visit(value, 0);
}
