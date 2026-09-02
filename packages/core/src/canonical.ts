import { isJson, type Json } from "./json.ts";

export class CanonicalJsonError extends TypeError {
  override readonly name = "CanonicalJsonError";
}

const invalidValue = (): never => {
  throw new CanonicalJsonError("Canonical JSON only accepts finite JSON values");
};

const encodeString = (value: string): string => JSON.stringify(value);

const isJsonArray = (value: Json): value is readonly Json[] => Array.isArray(value);

const encodeJson = (value: Json): string => {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return encodeString(value);
  if (isJsonArray(value)) return `[${value.map(encodeJson).join(",")}]`;

  const properties = Object.keys(value)
    .sort()
    .map((key) => `${encodeString(key)}:${encodeJson(value[key]!)}`);
  return `{${properties.join(",")}}`;
};

export const canonicalStringify = (value: Json): string => {
  let snapshot: Json;
  try {
    if (!isJson(value)) return invalidValue();
    snapshot = structuredClone(value);
    if (!isJson(snapshot)) return invalidValue();
  } catch {
    return invalidValue();
  }
  return encodeJson(snapshot);
};
