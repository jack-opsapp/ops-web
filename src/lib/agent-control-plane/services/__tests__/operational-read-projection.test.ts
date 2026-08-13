import { describe, expect, it } from "vitest";

import {
  canonicalOperationalProjection,
  hashOperationalProjection,
} from "../operational-read-projection";

describe("operational read projection canonicalization", () => {
  it("matches the cross-language golden vector byte for byte", () => {
    const projection = {
      z: 'quotes " backslash \\\\ newline\n unicode café 雪',
      a: [
        null,
        true,
        false,
        0,
        -12,
        125,
        Number.MAX_SAFE_INTEGER,
        { punct: "!:@,[]{}" },
      ],
    } as const;
    const canonical =
      '{"a":[null,true,false,0,-12,125,9007199254740991,{"punct":"!:@,[]{}"}],"z":"quotes \\" backslash \\\\\\\\ newline\\n unicode café 雪"}';

    expect(canonicalOperationalProjection(projection)).toBe(canonical);
    expect(hashOperationalProjection(projection)).toBe(
      "sha256:a09675457eaaf2363adab2ed25209060361e9b8cf523782a4d2cd62b6a9844a2"
    );
  });

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
    -0,
    Number.MAX_SAFE_INTEGER + 1,
    Symbol("bad"),
    () => undefined,
    BigInt(1),
    new Date(),
    Object.create({ inherited: true }),
    new Array(1),
  ])("rejects noncanonical runtime value %#", (value) => {
    expect(() => canonicalOperationalProjection(value as never)).toThrow(
      TypeError
    );
  });

  it("rejects accessors without invoking them and rejects cycles", () => {
    const getter = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        throw new Error("must not execute");
      },
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const symbolKeyed = { safe: true } as Record<PropertyKey, unknown>;
    symbolKeyed[Symbol("hidden")] = true;

    expect(() => canonicalOperationalProjection(getter as never)).toThrow(
      TypeError
    );
    expect(() => canonicalOperationalProjection(cyclic as never)).toThrow(
      TypeError
    );
    expect(() => canonicalOperationalProjection(symbolKeyed as never)).toThrow(
      TypeError
    );
  });
});
