import { describe, it, expect } from "vitest";

import {
  DEFAULT_PIPELINE_TABLE_COLUMNS,
  isPipelineTableEditableColumn,
  PIPELINE_TABLE_COLUMN_IDS,
  PIPELINE_TABLE_COLUMNS,
  PIPELINE_TABLE_EDITABLE_COLUMN_IDS,
  type PipelineTableColumnId,
} from "@/lib/types/pipeline-table";

describe("pipeline-table column model", () => {
  describe("PIPELINE_TABLE_COLUMNS registry", () => {
    it("has exactly one entry per id in PIPELINE_TABLE_COLUMN_IDS", () => {
      // Same length — no missing, no extra.
      expect(PIPELINE_TABLE_COLUMNS).toHaveLength(
        PIPELINE_TABLE_COLUMN_IDS.length
      );

      const registryIds = PIPELINE_TABLE_COLUMNS.map((column) => column.id);

      // No duplicate ids in the registry.
      expect(new Set(registryIds).size).toBe(registryIds.length);

      // Same id set as the canonical id list.
      expect(new Set(registryIds)).toEqual(new Set(PIPELINE_TABLE_COLUMN_IDS));
    });

    it("preserves the canonical display order from PIPELINE_TABLE_COLUMN_IDS", () => {
      const registryIds = PIPELINE_TABLE_COLUMNS.map((column) => column.id);
      expect(registryIds).toEqual([...PIPELINE_TABLE_COLUMN_IDS]);
    });

    it("never exposes probability-derived metrics", () => {
      for (const legacyMetric of ["win_probability", "weighted"]) {
        expect(PIPELINE_TABLE_COLUMN_IDS as readonly string[]).not.toContain(
          legacyMetric
        );
        expect(
          PIPELINE_TABLE_COLUMNS.map((column) => column.id) as readonly string[]
        ).not.toContain(legacyMetric);
      }
    });

    it("freezes exactly select, deal, and stage", () => {
      const frozenIds = PIPELINE_TABLE_COLUMNS.filter(
        (column) => column.frozen
      ).map((column) => column.id);
      expect(new Set(frozenIds)).toEqual(new Set(["select", "deal", "stage"]));
    });

    it("marks nothing other than select, deal, and stage as frozen", () => {
      for (const column of PIPELINE_TABLE_COLUMNS) {
        if (
          column.id === "select" ||
          column.id === "deal" ||
          column.id === "stage"
        ) {
          expect(column.frozen).toBe(true);
        } else {
          expect(column.frozen ?? false).toBe(false);
        }
      }
    });

    it("gives every column a table.column.<id> labelKey", () => {
      for (const column of PIPELINE_TABLE_COLUMNS) {
        expect(column.labelKey).toBe(`table.column.${column.id}`);
      }
    });

    it("pins select to a fixed 36px width", () => {
      const select = PIPELINE_TABLE_COLUMNS.find(
        (column) => column.id === "select"
      );
      expect(select).toBeDefined();
      expect(select?.kind).toBe("select");
      expect(select?.minWidth).toBe(36);
      expect(select?.width).toBe(36);
      expect(select?.maxWidth).toBe(36);
      expect(select?.sortable ?? false).toBe(false);
      expect(select?.editable ?? false).toBe(false);
    });

    it("keeps every width coherent (minWidth <= width <= maxWidth)", () => {
      for (const column of PIPELINE_TABLE_COLUMNS) {
        expect(column.minWidth).toBeLessThanOrEqual(column.width);
        expect(column.width).toBeLessThanOrEqual(column.maxWidth);
      }
    });
  });

  describe("editable columns", () => {
    it("declares the same editable set in the union list and the registry", () => {
      const registryEditableIds = PIPELINE_TABLE_COLUMNS.filter(
        (column) => column.editable
      ).map((column) => column.id);

      expect(new Set(registryEditableIds)).toEqual(
        new Set(PIPELINE_TABLE_EDITABLE_COLUMN_IDS)
      );
    });

    it("ensures every PIPELINE_TABLE_EDITABLE_COLUMN_IDS entry exists and is editable", () => {
      for (const editableId of PIPELINE_TABLE_EDITABLE_COLUMN_IDS) {
        const column = PIPELINE_TABLE_COLUMNS.find(
          (entry) => entry.id === editableId
        );
        expect(
          column,
          `missing registry entry for ${editableId}`
        ).toBeDefined();
        expect(column?.editable).toBe(true);
      }
    });

    it("never marks a non-editable id as editable in the registry", () => {
      const editableSet = new Set<PipelineTableColumnId>(
        PIPELINE_TABLE_EDITABLE_COLUMN_IDS
      );
      for (const column of PIPELINE_TABLE_COLUMNS) {
        if (!editableSet.has(column.id)) {
          expect(column.editable ?? false).toBe(false);
        }
      }
    });

    it("does NOT make stage inline-editable (it routes through a dialog)", () => {
      const stage = PIPELINE_TABLE_COLUMNS.find(
        (column) => column.id === "stage"
      );
      expect(stage).toBeDefined();
      expect(stage?.editable ?? false).toBe(false);
      expect(PIPELINE_TABLE_EDITABLE_COLUMN_IDS).not.toContain("stage");
    });

    it("does NOT make deal editable (identity / click-to-open column)", () => {
      const deal = PIPELINE_TABLE_COLUMNS.find(
        (column) => column.id === "deal"
      );
      expect(deal).toBeDefined();
      expect(deal?.editable ?? false).toBe(false);
    });
  });

  describe("isPipelineTableEditableColumn", () => {
    it("returns true for inline-editable columns", () => {
      expect(isPipelineTableEditableColumn("value")).toBe(true);
      expect(isPipelineTableEditableColumn("next_follow_up")).toBe(true);
      expect(isPipelineTableEditableColumn("expected_close")).toBe(true);
      expect(isPipelineTableEditableColumn("assignee")).toBe(true);
    });

    it("returns false for non-editable columns", () => {
      expect(isPipelineTableEditableColumn("stage")).toBe(false);
      expect(isPipelineTableEditableColumn("deal")).toBe(false);
      expect(isPipelineTableEditableColumn("select")).toBe(false);
    });

    it("agrees with PIPELINE_TABLE_EDITABLE_COLUMN_IDS for every column id", () => {
      const editableSet = new Set<PipelineTableColumnId>(
        PIPELINE_TABLE_EDITABLE_COLUMN_IDS
      );
      for (const id of PIPELINE_TABLE_COLUMN_IDS) {
        expect(isPipelineTableEditableColumn(id)).toBe(editableSet.has(id));
      }
    });
  });

  describe("DEFAULT_PIPELINE_TABLE_COLUMNS", () => {
    it("is a subset of PIPELINE_TABLE_COLUMN_IDS", () => {
      const allIds = new Set<PipelineTableColumnId>(PIPELINE_TABLE_COLUMN_IDS);
      for (const id of DEFAULT_PIPELINE_TABLE_COLUMNS) {
        expect(allIds.has(id), `${id} is not a known column id`).toBe(true);
      }
    });

    it("contains no duplicates", () => {
      expect(new Set(DEFAULT_PIPELINE_TABLE_COLUMNS).size).toBe(
        DEFAULT_PIPELINE_TABLE_COLUMNS.length
      );
    });

    it("matches the lean default-visible set", () => {
      expect(DEFAULT_PIPELINE_TABLE_COLUMNS).toEqual([
        "select",
        "deal",
        "stage",
        "client",
        "value",
        "age_in_stage",
        "next_follow_up",
        "assignee",
      ]);
    });
  });
});
