import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REFERRAL_SOURCES } from "@/lib/data/referral-sources";

const swiftCandidates = [
  resolve(
    process.cwd(),
    "../ops-ios/OPS/Onboarding/Models/ReferralSource.swift"
  ),
  resolve(
    process.cwd(),
    "../cross-platform-analytics-ios/OPS/Onboarding/Models/ReferralSource.swift"
  ),
  resolve(
    process.cwd(),
    "../../ops-ios/OPS/Onboarding/Models/ReferralSource.swift"
  ),
];
const swiftPath = swiftCandidates.find(existsSync);

const swiftCases: Record<(typeof REFERRAL_SOURCES)[number]["slug"], string> = {
  instagram: "case instagram",
  facebook: "case facebook",
  youtube: "case youtube",
  google: "case google",
  app_store: 'case appStore = "app_store"',
  word_of_mouth: 'case wordOfMouth = "word_of_mouth"',
  other: "case other",
};

describe("web and iOS referral-source parity", () => {
  it("keeps every stable slug and label identical", () => {
    expect(swiftPath, "ReferralSource.swift must be available").toBeDefined();
    const swift = readFileSync(swiftPath!, "utf8");

    for (const source of REFERRAL_SOURCES) {
      expect(swift).toContain(swiftCases[source.slug]);
      expect(swift).toContain(`return "${source.label}"`);
    }
    expect(REFERRAL_SOURCES).toHaveLength(7);
  });
});
