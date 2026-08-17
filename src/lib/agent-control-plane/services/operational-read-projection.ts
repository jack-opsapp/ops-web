import "server-only";

import { createHash } from "node:crypto";

type CanonicalPrimitive = string | number | boolean | null;
export interface CanonicalProjectionObject {
  readonly [key: string]: CanonicalProjection;
}
export type CanonicalProjection =
  | CanonicalPrimitive
  | readonly CanonicalProjection[]
  | CanonicalProjectionObject;

function canonicalize(value: unknown, ancestors: WeakSet<object>): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError(
        "Operational projection numbers must be safe integers"
      );
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(
      "Operational projection values must be JSON primitives"
    );
  }
  if (ancestors.has(value)) {
    throw new TypeError("Operational projections cannot be cyclic");
  }
  const prototype = Object.getPrototypeOf(value);
  const isArray = Array.isArray(value);
  if (
    (isArray && prototype !== Array.prototype) ||
    (!isArray && prototype !== Object.prototype && prototype !== null)
  ) {
    throw new TypeError(
      "Operational projections require plain objects and arrays"
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new TypeError("Operational projections cannot contain symbol keys");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.entries(descriptors).some(
      ([key, descriptor]) =>
        (!(isArray && key === "length") && !("value" in descriptor)) ||
        (!(isArray && key === "length") && descriptor.enumerable !== true)
    )
  ) {
    throw new TypeError(
      "Operational projection properties must be enumerable data"
    );
  }
  ancestors.add(value);
  try {
    if (isArray) {
      const array = value as readonly unknown[];
      const keys = Object.keys(array);
      if (
        keys.length !== array.length ||
        keys.some((key, index) => key !== String(index))
      ) {
        throw new TypeError("Operational projection arrays must be dense");
      }
      return `[${array.map((item) => canonicalize(item, ancestors)).join(",")}]`;
    }
    const object = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(object).sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0
    );
    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalize(object[key], ancestors)}`
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalOperationalProjection(
  value: CanonicalProjection
): string {
  return canonicalize(value, new WeakSet());
}

export function hashOperationalProjection(
  value: CanonicalProjection
): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(canonicalize(value, new WeakSet()), "utf8")
    .digest("hex")}`;
}
