import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface FixtureManifestFile {
  readonly path: string;
  readonly sha256: string;
}

interface FixtureManifestProducer {
  readonly repository: "ops-decks-ios" | "ops-ios";
  readonly producer_code_commit: string;
  readonly generated_artifact_commit: string;
  readonly files: readonly FixtureManifestFile[];
}

interface FixtureManifest {
  readonly fixture_revision: string;
  readonly calculator_revision: string;
  readonly producers: readonly FixtureManifestProducer[];
}

type JsonObject = Readonly<Record<string, unknown>>;

const FIXTURE_ROOT = resolve(
  process.cwd(),
  "src/lib/agent-control-plane/services/p2/deck-design/__fixtures__"
);
const manifest = readJson("manifest.json") as unknown as FixtureManifest;

function readBytes(path: string) {
  return readFileSync(resolve(FIXTURE_ROOT, path));
}

function readJson(path: string): JsonObject {
  return JSON.parse(readBytes(path).toString("utf8")) as JsonObject;
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function expectSortedObjectKeys(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      expectSortedObjectKeys(entry, path + "[" + index + "]")
    );
    return;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    expect(
      entries.map(([key]) => key),
      path
    ).toEqual(entries.map(([key]) => key).sort());
    for (const [key, entry] of entries) {
      expectSortedObjectKeys(entry, path + "." + key);
    }
  }
}

function measurementProjection(fixture: JsonObject) {
  const {
    producer_repository: _producerRepository,
    producer_code_commit: _producerCodeCommit,
    input_drawing_json: _inputDrawingJson,
    ...projection
  } = fixture;
  return projection;
}

describe("deck geometry golden fixtures", () => {
  it("pins both immutable producer chains and all eleven fixture hashes", () => {
    expect(manifest).toMatchObject({
      fixture_revision: "deck-geometry-golden:2026-08-22.v1",
      calculator_revision: "deck-geometry-calculator:2026-08-22.v1",
      producers: [
        {
          repository: "ops-decks-ios",
          producer_code_commit: "6f76e07ef54799e7bf9f4e0a4760c69ae08a61d9",
          generated_artifact_commit: "c1262418cdf6aefaacc42b6b283ae0878e0e4e88",
        },
        {
          repository: "ops-ios",
          producer_code_commit: "2a5f15accd02e7de0f344ee55305bfb6b6c23507",
          generated_artifact_commit: "d095939fdd3a648c2d233517995ee44c8a017578",
        },
      ],
    });

    const files = manifest.producers.flatMap((producer) =>
      producer.files.map((file) => ({ producer, file }))
    );
    expect(files).toHaveLength(11);
    expect(new Set(files.map(({ file }) => file.path)).size).toBe(11);

    for (const { producer, file } of files) {
      expect(file.path).toMatch(
        new RegExp(
          "^" + producer.repository + "/[a-z0-9]+(?:-[a-z0-9]+)*\\.json$"
        )
      );
      const bytes = readBytes(file.path);
      expect(sha256(bytes), file.path).toBe(file.sha256);

      const fixture = JSON.parse(bytes.toString("utf8")) as JsonObject;
      expect(fixture).toMatchObject({
        producer_repository: producer.repository,
        producer_code_commit: producer.producer_code_commit,
        fixture_revision: manifest.fixture_revision,
        calculator_revision: manifest.calculator_revision,
      });
      const text = bytes.toString("utf8");
      expect(text.endsWith("\n"), file.path).toBe(true);
      expect(text.endsWith("\n\n"), file.path).toBe(false);
      expectSortedObjectKeys(fixture);
    }
  });

  it("proves identical calculator outputs across both apps for every common drawing", () => {
    const commonNames = [
      "adjacent-faces-no-surfaces",
      "legacy-self-intersection",
      "missing-and-stale-dimensions",
      "multi-level-connection",
      "single-level-gate-stair-parapet",
    ] as const;

    for (const name of commonNames) {
      const deckKit = readJson("ops-decks-ios/" + name + ".json");
      const embedded = readJson("ops-ios/" + name + ".json");
      expect(measurementProjection(embedded), name).toEqual(
        measurementProjection(deckKit)
      );
    }
  });

  it("pins adjacent detected faces without inventing legacy deck-board components", () => {
    for (const repository of ["ops-decks-ios", "ops-ios"] as const) {
      const fixture = readJson(repository + "/adjacent-faces-no-surfaces.json");
      expect(fixture).toMatchObject({
        expected_full_precision_square_inches: 20_000,
        component_witnesses: [],
        measurement_quality: {
          area: { state: "authoritative", warning: null },
          component_witness: { state: "authoritative", warning: null },
        },
        input_drawing_json: {
          components: [],
          surfaces: [],
        },
      });
    }
  });

  it("keeps DeckKit's detected surface-hole case in the immutable truth set", () => {
    const fixture = readJson("ops-decks-ios/surface-hole.json");
    expect(fixture).toMatchObject({
      expected_full_precision_square_inches: 14_976,
      expected_flat_railing_inches: 0,
      expected_stair_railing_inches: 0,
      expected_parapet_inches: 0,
      expected_combined_guard_inches: 0,
      measurement_quality: {
        area: { state: "authoritative", warning: null },
      },
    });
  });
});
