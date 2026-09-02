import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CANONICAL_SUBMISSION_VERSION,
  canonicalJson,
  canonicalizeAnswers,
  canonicalizeSubmission,
  normalizeAttributionUrl,
} from "@/lib/external-api/intake/canonicalize";
import {
  canonicalizeContactIdentity,
  normalizeComparisonName,
} from "@/lib/external-api/intake/contact-identity";
import {
  assertIdempotencyKeyRetirementSafe,
  deriveActiveIdempotencyDigest,
  deriveIdempotencyLookupCandidates,
  findMatchingIdempotencyDigest,
} from "@/lib/external-api/intake/idempotency";
import type { SubmissionRequest } from "@/lib/external-api/contracts/intake";

const SOURCE_ID = "src_abcdefghijklmnopqrstuv";
const FORM_ID = "frm_abcdefghijklmnopqrstuv";
const UPLOAD_A = "upl_aaaaaaaaaaaaaaaaaaaaaa";
const UPLOAD_B = "upl_bbbbbbbbbbbbbbbbbbbbbb";

const baseSubmission: SubmissionRequest = {
  sourceId: SOURCE_ID,
  formId: FORM_ID,
  contact: {
    name: "  Ana   María  ",
    email: "  ANA@example.CA ",
    phone: "(604) 555-0199",
    phoneRegion: "CA",
    organizationName: "  North   Shore Decks ",
  },
  serviceAddress: {
    line1: "  10   Main Street ",
    city: " Vancouver ",
    region: " BC ",
    postalCode: " V6B 1A1 ",
    countryCode: "CA",
  },
  workSummary: " Replace   the deck. ",
  preferredTiming: "  This   fall ",
  answers: [
    {
      fieldKey: "materials",
      label: " Materials ",
      type: "string_list",
      value: [" Cedar ", "aluminum", "cedar"],
    },
    {
      fieldKey: "budget",
      label: " Budget ",
      type: "number",
      value: 12000,
    },
  ],
  attribution: {
    utmSource: " Google ",
    landingPageUrl:
      "https://user:pass@Example.CA:443/decks/../deck-builds?gclid=secret#quote",
  },
  uploadIds: [UPLOAD_B, UPLOAD_A],
  externalSubmissionId: "  website-order-42 ",
};

describe("external intake canonicalization", () => {
  it("normalizes validated email, reliable phones, and comparison-only names", () => {
    expect(
      canonicalizeContactIdentity({
        name: "  Ana   María ",
        email: "  ANA@Example.CA ",
        phone: "(604) 555-0199",
        phoneRegion: "CA",
      })
    ).toEqual({
      evidence: {
        name: "Ana María",
        email: "ANA@Example.CA",
        phone: "(604) 555-0199",
        phoneRegion: "CA",
      },
      normalizedEmail: "ana@example.ca",
      normalizedPhone: "+16045550199",
      normalizedName: "ana maria",
      identitySignals: [
        { kind: "email", value: "ana@example.ca" },
        { kind: "phone", value: "+16045550199" },
      ],
    });

    const international = canonicalizeContactIdentity({
      name: "Mika",
      phone: "+442079460018",
    });
    expect(international.normalizedPhone).toBe("+442079460018");

    const localWithoutRegion = canonicalizeContactIdentity({
      name: "Mika",
      phone: "020 7946 0018",
    });
    expect(localWithoutRegion.evidence.phone).toBe("020 7946 0018");
    expect(localWithoutRegion.normalizedPhone).toBeNull();
    expect(localWithoutRegion.identitySignals).toEqual([]);
    expect(
      canonicalizeContactIdentity(
        { name: "Mika", phone: "020 7946 0018" },
        { defaultPhoneRegion: "GB" }
      ).normalizedPhone
    ).toBe("+442079460018");
    expect(() =>
      canonicalizeContactIdentity(
        { name: "Mika", phone: "020 7946 0018" },
        { defaultPhoneRegion: "ZZ" }
      )
    ).toThrow("contact phone region is unsupported");
    expect(normalizeComparisonName("  Élodie   O'Neil ")).toBe("elodie o neil");
  });

  it("sorts typed answers and normalizes unordered list values", () => {
    expect(canonicalizeAnswers(baseSubmission.answers)).toEqual([
      {
        fieldKey: "budget",
        label: "Budget",
        type: "number",
        value: 12000,
      },
      {
        fieldKey: "materials",
        label: "Materials",
        type: "string_list",
        value: ["aluminum", "Cedar"],
      },
    ]);
  });

  it("normalizes URLs without leaking credentials, query data, or fragments", () => {
    expect(
      normalizeAttributionUrl(
        "https://user:pass@Example.CA:443/decks/../deck-builds?gclid=secret#quote"
      )
    ).toEqual({
      host: "example.ca",
      path: "/deck-builds",
      normalizedUrl: "https://example.ca/deck-builds",
    });
  });

  it("produces one stable versioned hash for only approved submission fields", () => {
    const first = canonicalizeSubmission(baseSubmission);
    const reordered = canonicalizeSubmission({
      ...baseSubmission,
      contact: {
        organizationName: "North Shore Decks",
        phoneRegion: "CA",
        phone: "(604) 555-0199",
        email: "ana@example.ca",
        name: "Ana María",
      },
      workSummary: "Replace the deck.",
      preferredTiming: "This fall",
      answers: [...baseSubmission.answers].reverse(),
      uploadIds: [UPLOAD_A, UPLOAD_B],
      externalSubmissionId: "website-order-42",
    });

    expect(first.version).toBe(CANONICAL_SUBMISSION_VERSION);
    expect(first.canonicalJson).toBe(reordered.canonicalJson);
    expect(first.sha256).toBe(reordered.sha256);
    expect(first.sha256).toBe(
      createHash("sha256").update(first.canonicalJson).digest("hex")
    );

    const unrelatedRuntimeState = {
      ...baseSubmission,
      credentialId: "credential-rotated",
      requestReceivedAt: "2026-07-26T20:00:00.000Z",
      attachmentScanState: "pending",
    };
    expect(canonicalizeSubmission(unrelatedRuntimeState).sha256).toBe(
      first.sha256
    );
    expect(
      canonicalizeSubmission({
        ...baseSubmission,
        workSummary: "Replace the front stairs.",
      }).sha256
    ).not.toBe(first.sha256);
  });

  it("canonicalizes object keys while preserving meaningful array order", () => {
    expect(
      canonicalJson({
        z: 1,
        a: [{ y: 2, x: 1 }, "second"],
      })
    ).toBe('{"a":[{"x":1,"y":2},"second"],"z":1}');
  });
});

describe("rotation-safe idempotency digests", () => {
  const keyRing = {
    activeKid: 2,
    keys: new Map([
      [1, Buffer.alloc(32, 1)],
      [2, Buffer.alloc(32, 2)],
    ]),
  };

  it.each([
    [
      "upload",
      {
        kind: "principal" as const,
        companyId: "c4f852a5-3530-4b2f-b5fa-0a747d32e44a",
        principalId: "51fb3a56-08c5-4512-b912-a549833687bd",
        namespace: "upload_batch" as const,
        key: "upload-request-0001",
      },
    ],
    [
      "submission",
      {
        kind: "principal" as const,
        companyId: "c4f852a5-3530-4b2f-b5fa-0a747d32e44a",
        principalId: "51fb3a56-08c5-4512-b912-a549833687bd",
        namespace: "submission" as const,
        key: "submission-request-0001",
      },
    ],
    [
      "external submission",
      {
        kind: "external_submission" as const,
        companyId: "c4f852a5-3530-4b2f-b5fa-0a747d32e44a",
        sourceId: "d960d8d5-1b5f-41c4-9c64-521ae14ae77e",
        externalSubmissionId: "form-provider-123",
      },
    ],
  ])(
    "finds an existing %s ledger through a historical key",
    (_label, identity) => {
      const oldRing = {
        activeKid: 1,
        keys: new Map([[1, Buffer.alloc(32, 1)]]),
      };
      const stored = deriveActiveIdempotencyDigest(identity, oldRing);
      const candidates = deriveIdempotencyLookupCandidates(identity, keyRing);
      const active = deriveActiveIdempotencyDigest(identity, keyRing);

      expect(findMatchingIdempotencyDigest(stored, candidates)).toMatchObject({
        kid: stored.kid,
        digest: stored.digest,
        writeEligible: false,
      });
      expect(active.kid).toBe(2);
      expect(active).not.toEqual(stored);
      expect(candidates.filter((candidate) => candidate.writeEligible)).toEqual(
        [active]
      );
    }
  );

  it("refuses to retire a digest key while retained ledgers reference it", () => {
    expect(() => assertIdempotencyKeyRetirementSafe(1, [1, 2, 1])).toThrow(
      "idempotency digest key 1 is still referenced"
    );
    expect(() => assertIdempotencyKeyRetirementSafe(3, [1, 2])).not.toThrow();
  });
});
