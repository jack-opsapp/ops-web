import { describe, expect, it } from "vitest";
import {
  normalizePropertyAddressIdentity,
  parsePropertyAddressIdentity,
} from "@/lib/utils/property-address-identity";

describe("property-address identity boundary", () => {
  it.each([
    "Victoria",
    "Langford",
    "Esquimalt, BC",
    "Tillicum",
    "Henderson",
    "North Saanich",
    "Saanich Cedar Hill area",
    "Greater Victoria Region",
    "Victoria, BC V8W 1P6",
    "V8W 1P6",
    "PO Box 123, Victoria BC",
    "Unit 2, Victoria",
    "near Cedar Hill",
    "250 888 3674",
    "2026 07 28",
    "123 456",
    "123 Victoria",
    "2508883674 Victoria",
    "20260728 Main",
    "123 Cedar",
  ])("rejects contextual or mailing-only location %j", (value) => {
    expect(parsePropertyAddressIdentity(value)).toBeNull();
    expect(normalizePropertyAddressIdentity(value)).toBeNull();
  });

  it.each([
    ["2745 Fernwood Rd, Victoria BC", "2745 fernwood road"],
    ["2745 Fernwood Road", "2745 fernwood road"],
    ["123 Main St, Suite 2, Victoria BC", "123 main street unit 2"],
    ["Unit 2, 123 Main Street", "123 main street unit 2"],
    ["#2 123 Main St.", "123 main street unit 2"],
    ["2-123 Main St", "123 main street unit 2"],
    ["12345 Hwy 17, Kenora ON", "12345 highway 17"],
    ["4-123 Range Road 215, Alberta", "123 range road 215 unit 4"],
    ["123 Cedar Way, Victoria BC", "123 cedar way"],
    ["45 Ridge Trl, Saanich BC", "45 ridge trail"],
    ["9 Garden Cir, Langford BC", "9 garden circle"],
    ["RR 2 Site 4 Box 19", "rr 2 site 4 box 19"],
    ["Site 4 Box 19 RR 2", "site 4 box 19 rr 2"],
    ["Lot 12 Concession 3", "lot 12 concession 3"],
    ["Parcel 009-123-456", "parcel 009-123-456"],
    ["PID 009-123-456", "pid 009-123-456"],
  ])("normalizes property-level identity %j", (value, expected) => {
    expect(normalizePropertyAddressIdentity(value)).toBe(expected);
  });

  it("keeps different units distinct while folding equivalent designators", () => {
    expect(normalizePropertyAddressIdentity("123 Main St Apt 2")).toBe(
      normalizePropertyAddressIdentity("Unit 2, 123 Main Street")
    );
    expect(normalizePropertyAddressIdentity("123 Main St Apt 2")).not.toBe(
      normalizePropertyAddressIdentity("123 Main St Apt 3")
    );
  });

  it("can return the property base without dropping qualification", () => {
    expect(
      normalizePropertyAddressIdentity("123 Main St Apt 2", {
        includeUnit: false,
      })
    ).toBe("123 main street");
  });
});
