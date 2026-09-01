export type JsonPrimitive = boolean | null | number | string;

export type Json = JsonPrimitive | readonly Json[] | { readonly [key: string]: Json };

export type JsonCandidate =
  | JsonPrimitive
  | bigint
  | symbol
  | undefined
  | readonly JsonCandidate[]
  | { readonly [key: string]: JsonCandidate };

const hasJsonPrototype = (value: object): boolean => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isEnumerableDataProperty = (value: object, key: PropertyKey): boolean => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor?.enumerable === true && "value" in descriptor;
};

const hasJsonObjectShape = (value: object): boolean =>
  Reflect.ownKeys(value).every(
    (key) => typeof key === "string" && isEnumerableDataProperty(value, key),
  );

const hasJsonArrayShape = (value: readonly JsonCandidate[]): boolean => {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return false;
  }

  const keys = Reflect.ownKeys(value);
  return (
    keys.length === value.length + 1 &&
    Array.from({ length: value.length }, (_, index) => index).every((index) =>
      isEnumerableDataProperty(value, index),
    )
  );
};

const isJsonValue = (value: JsonCandidate, ancestors: WeakSet<object>): value is Json => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    if (!hasJsonArrayShape(value)) {
      return false;
    }

    if (ancestors.has(value)) {
      return false;
    }

    ancestors.add(value);
    const valid = value.every((item) => isJsonValue(item, ancestors));
    ancestors.delete(value);
    return valid;
  }

  if (typeof value === "object") {
    if (!hasJsonPrototype(value) || !hasJsonObjectShape(value) || ancestors.has(value)) {
      return false;
    }

    ancestors.add(value);
    const valid = Object.values(value).every((item) => isJsonValue(item, ancestors));
    ancestors.delete(value);
    return valid;
  }

  return false;
};

export const isJson = (value: JsonCandidate): value is Json => isJsonValue(value, new WeakSet());
