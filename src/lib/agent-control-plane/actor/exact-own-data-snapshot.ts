import "server-only";

import { types as nodeTypes } from "node:util";

const arrayIsArray = Array.isArray;
const isProxy = nodeTypes.isProxy;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectCreate = Object.create;
const defineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectHasOwn = Object.hasOwn;
const reflectOwnKeys = Reflect.ownKeys;

/**
 * Copy only an explicitly allowed set of own, enumerable data properties.
 * Accessors, proxies, symbols, inherited substitutes, and hidden/extra fields
 * are rejected without reading a caller-controlled property value.
 */
export function snapshotExactOwnEnumerableData(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): Readonly<Record<string, unknown>> | null {
  if (typeof value !== "object" || value === null || arrayIsArray(value)) {
    return null;
  }

  try {
    if (isProxy(value)) return null;

    const descriptors = getOwnPropertyDescriptors(value);
    const keys = reflectOwnKeys(descriptors);
    const isAllowedKey = (candidate: string): boolean => {
      for (let index = 0; index < requiredKeys.length; index += 1) {
        if (requiredKeys[index] === candidate) return true;
      }
      for (let index = 0; index < optionalKeys.length; index += 1) {
        if (optionalKeys[index] === candidate) return true;
      }
      return false;
    };
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string" || !isAllowedKey(key)) return null;
    }
    for (let index = 0; index < requiredKeys.length; index += 1) {
      if (!objectHasOwn(descriptors, requiredKeys[index])) return null;
    }

    const snapshot = objectCreate(null) as Record<string, unknown>;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== "string") return null;
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return null;
      }
      defineProperty(snapshot, key, {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false,
      });
    }
    return objectFreeze(snapshot);
  } catch {
    return null;
  }
}

export function snapshotHasExactlyKeys(
  snapshot: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[]
): boolean {
  const keys = reflectOwnKeys(snapshot);
  if (keys.length !== expectedKeys.length) return false;
  for (let index = 0; index < expectedKeys.length; index += 1) {
    if (!objectHasOwn(snapshot, expectedKeys[index])) return false;
  }
  return true;
}
