import { describe, it, expect } from "vitest";
import {
  buildEditingSchema,
  buildCreatingSchema,
} from "@/components/ops/projects/workspace/edit-create/project-edit-create-body";

const MESSAGES = {
  titleTooLong: "titleTooLong",
  tradeRequired: "tradeRequired",
};

// The exact value shape an untouched creating-mode form submits: EMPTY_DEFAULTS
// as round-tripped through the DOM for registered fields (strings stay strings,
// setValue-only fields keep their defaults). If this shape ever stops parsing
// for a reason the UI cannot display, the CREATE button dead-ends silently —
// the create-lead ESTIMATED VALUE bug (f4e85e75) was exactly that class.
function untouchedCreating() {
  return {
    title: "",
    titleIsAuto: true,
    clientId: null,
    address: null,
    latitude: null,
    longitude: null,
    projectDescription: null,
    trade: null,
    startDate: "",
    endDate: "",
    duration: "",
    visibility: "all",
  };
}

describe("buildCreatingSchema — untouched submit", () => {
  it("fails ONLY on trade (the one required field, and its error renders in the identity tab)", () => {
    const parsed = buildCreatingSchema(MESSAGES).safeParse(untouchedCreating());
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const paths = parsed.error.issues.map((i) => i.path.join("."));
      expect(paths).toEqual(["trade"]);
      expect(parsed.error.issues[0]!.message).toBe("tradeRequired");
    }
  });

  it("passes once trade is picked — everything else may stay untouched", () => {
    const parsed = buildCreatingSchema(MESSAGES).safeParse({
      ...untouchedCreating(),
      trade: "roofing",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("buildEditingSchema — untouched submit", () => {
  it("passes with a legacy project's nulls (trade, client, address, coordinates)", () => {
    const parsed = buildEditingSchema(MESSAGES).safeParse(untouchedCreating());
    expect(parsed.success).toBe(true);
  });
});

describe("duration — a type=number input kept as z.string() by design", () => {
  // The DOM value of a never-focused (or cleared) number input is "" — the
  // schema must accept it as the cleared state. Numeric conversion happens in
  // onSubmit ("" → null, "14" → 14), never in the schema.
  it("accepts \"\" (untouched/cleared) and numeric strings", () => {
    const schema = buildEditingSchema(MESSAGES);
    expect(
      schema.safeParse({ ...untouchedCreating(), duration: "" }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ ...untouchedCreating(), duration: "14" }).success,
    ).toBe(true);
  });

  it("rejects a raw number — duration must stay a string until onSubmit", () => {
    const parsed = buildEditingSchema(MESSAGES).safeParse({
      ...untouchedCreating(),
      duration: 14,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("latitude/longitude — setValue-only z.number() fields", () => {
  // These fields have no visible input and no error display. They stay valid
  // because every write path is number|null (Mapbox GeocodingResult filters
  // nullish coordinates; projects.latitude/longitude are DOUBLE PRECISION).
  // A string coordinate is therefore a validation failure the operator can
  // only see via the invalid-submit tab report — pin both truths.
  it("accepts null and finite numbers", () => {
    const schema = buildEditingSchema(MESSAGES);
    expect(
      schema.safeParse({
        ...untouchedCreating(),
        latitude: 37.808,
        longitude: -122.41,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ ...untouchedCreating(), latitude: null, longitude: null })
        .success,
    ).toBe(true);
  });

  it("rejects string coordinates and NaN", () => {
    const schema = buildEditingSchema(MESSAGES);
    expect(
      schema.safeParse({ ...untouchedCreating(), latitude: "37.808" }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...untouchedCreating(), latitude: Number.NaN }).success,
    ).toBe(false);
  });
});

describe("title — max(200) with an inline error", () => {
  it("accepts 200 characters and rejects 201", () => {
    const schema = buildEditingSchema(MESSAGES);
    expect(
      schema.safeParse({ ...untouchedCreating(), title: "x".repeat(200) })
        .success,
    ).toBe(true);
    const tooLong = schema.safeParse({
      ...untouchedCreating(),
      title: "x".repeat(201),
    });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) {
      expect(tooLong.error.issues[0]!.message).toBe("titleTooLong");
    }
  });
});
