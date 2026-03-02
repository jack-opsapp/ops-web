"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { UploadStep } from "./import/upload-step";
import {
  ConfigureStep,
  type Orientation,
  type Mode,
} from "./import/configure-step";
import {
  MapColumnsStep,
  isMappingValid,
  type ColumnMapping,
} from "./import/map-columns-step";
import {
  PreviewStep,
  buildPreviewItems,
  type PreviewItem,
} from "./import/preview-step";
import { ImportStep } from "./import/import-step";

// ─── Step definitions ────────────────────────────────────────────────────────

const STEPS = [
  { number: 1, label: "Upload" },
  { number: 2, label: "Configure" },
  { number: 3, label: "Map Columns" },
  { number: 4, label: "Preview" },
  { number: 5, label: "Import" },
] as const;

// ─── Component ───────────────────────────────────────────────────────────────

export function ImportTab() {
  // Wizard step (1-based)
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1: Upload
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);

  // Step 2: Configure
  const [orientation, setOrientation] = useState<Orientation>("rows");
  const [mode, setMode] = useState<Mode>("one-per-row");

  // Step 3: Map Columns
  const [mapping, setMapping] = useState<ColumnMapping>({});

  // Step 4: Preview
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);

  // ── Progress percentage for top bar ────────────────────────────────────────
  const progressPct = Math.round(((currentStep - 1) / (STEPS.length - 1)) * 100);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleParsed = useCallback(
    (parsedHeaders: string[], parsedRows: string[][]) => {
      setHeaders(parsedHeaders);
      setRows(parsedRows);

      // Auto-suggest mapping based on header names
      const autoMapping: ColumnMapping = {};
      const headerLower = parsedHeaders.map((h) => h.toLowerCase().trim());

      headerLower.forEach((h, i) => {
        if (h.includes("name") || h.includes("item") || h.includes("product")) {
          autoMapping[i] = "name";
        } else if (
          h.includes("qty") ||
          h.includes("quantity") ||
          h.includes("count") ||
          h.includes("amount")
        ) {
          autoMapping[i] = "quantity";
        } else if (h.includes("unit") || h.includes("uom")) {
          autoMapping[i] = "unit";
        } else if (h.includes("sku") || h.includes("part") || h.includes("code")) {
          autoMapping[i] = "sku";
        } else if (h.includes("tag") || h.includes("category")) {
          autoMapping[i] = "tags";
        } else if (h.includes("desc")) {
          autoMapping[i] = "description";
        } else if (h.includes("note")) {
          autoMapping[i] = "notes";
        } else {
          autoMapping[i] = "skip";
        }
      });

      setMapping(autoMapping);
      setCurrentStep(2);
    },
    []
  );

  const handleNext = useCallback(() => {
    if (currentStep === 3) {
      // Build preview items from CSV data + mapping
      const items = buildPreviewItems(rows, mapping);
      setPreviewItems(items);
    }
    setCurrentStep((s) => Math.min(s + 1, STEPS.length));
  }, [currentStep, rows, mapping]);

  const handleBack = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 1));
  }, []);

  const handleDone = useCallback(() => {
    // Reset wizard
    setCurrentStep(1);
    setHeaders([]);
    setRows([]);
    setOrientation("rows");
    setMode("one-per-row");
    setMapping({});
    setPreviewItems([]);
  }, []);

  // ── Can proceed checks ────────────────────────────────────────────────────
  const canNext = (() => {
    switch (currentStep) {
      case 1:
        return false; // Upload auto-advances
      case 2:
        return true; // Configure always valid
      case 3:
        return isMappingValid(mapping);
      case 4:
        return previewItems.length > 0;
      default:
        return false;
    }
  })();

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 py-4">
      {/* Step indicator */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          {STEPS.map((step) => (
            <div
              key={step.number}
              className="flex items-center gap-1.5"
            >
              <div
                className={cn(
                  "h-6 w-6 rounded-full flex items-center justify-center",
                  "font-mohave text-caption-sm font-medium",
                  "transition-all duration-200",
                  currentStep === step.number
                    ? "bg-ops-accent text-white"
                    : currentStep > step.number
                      ? "bg-ops-accent/30 text-ops-accent"
                      : "bg-[rgba(255,255,255,0.07)] text-text-tertiary"
                )}
              >
                {step.number}
              </div>
              <span
                className={cn(
                  "font-mohave text-caption-sm hidden sm:inline",
                  "transition-colors duration-200",
                  currentStep === step.number
                    ? "text-text-primary"
                    : currentStep > step.number
                      ? "text-text-secondary"
                      : "text-text-tertiary"
                )}
              >
                {step.label}
              </span>
            </div>
          ))}
        </div>
        <Progress value={progressPct} />
      </div>

      {/* Step content */}
      <div className="min-h-[300px]">
        {currentStep === 1 && <UploadStep onParsed={handleParsed} />}

        {currentStep === 2 && (
          <ConfigureStep
            orientation={orientation}
            onOrientationChange={setOrientation}
            mode={mode}
            onModeChange={setMode}
          />
        )}

        {currentStep === 3 && (
          <MapColumnsStep
            headers={headers}
            rows={rows}
            mapping={mapping}
            onMappingChange={setMapping}
          />
        )}

        {currentStep === 4 && (
          <PreviewStep
            headers={headers}
            rows={rows}
            mapping={mapping}
            previewItems={previewItems}
            onPreviewItemsChange={setPreviewItems}
          />
        )}

        {currentStep === 5 && (
          <ImportStep items={previewItems} onDone={handleDone} />
        )}
      </div>

      {/* Navigation buttons (hidden on step 1 and step 5) */}
      {currentStep > 1 && currentStep < 5 && (
        <div className="flex justify-between items-center pt-2 border-t border-border">
          <Button variant="ghost" onClick={handleBack}>
            Back
          </Button>
          <Button
            variant="primary"
            onClick={handleNext}
            disabled={!canNext}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
