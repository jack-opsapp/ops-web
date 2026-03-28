"use client";

import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";

// ─── CSV Parser ──────────────────────────────────────────────────────────────

function parseLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface UploadStepProps {
  onParsed: (headers: string[], rows: string[][]) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function UploadStep({ onParsed }: UploadStepProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const processFile = useCallback(
    (file: File) => {
      setError(null);

      if (!file.name.toLowerCase().endsWith(".csv")) {
        setError("Please upload a .csv file");
        return;
      }

      setFileName(file.name);

      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text !== "string") {
          setError("Failed to read file");
          return;
        }

        const { headers, rows } = parseCSV(text);

        if (headers.length === 0) {
          setError("CSV file appears to be empty");
          return;
        }

        if (rows.length === 0) {
          setError("CSV file has headers but no data rows");
          return;
        }

        onParsed(headers, rows);
      };

      reader.onerror = () => {
        setError("Failed to read file");
      };

      reader.readAsText(file);
    },
    [onParsed]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div
        role="button"
        tabIndex={0}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            fileInputRef.current?.click();
          }
        }}
        className={cn(
          "w-full min-h-[200px]",
          "border-2 border-dashed rounded-md",
          "flex flex-col items-center justify-center gap-4",
          "cursor-pointer transition-colors duration-150",
          isDragOver
            ? "border-ops-accent bg-ops-accent/5"
            : "border-border hover:border-border-strong"
        )}
      >
        <Upload className="h-8 w-8 text-text-tertiary" />
        <div className="text-center">
          <p className="font-mohave text-body text-text-primary">
            Drag and drop your CSV file here
          </p>
          <p className="font-mohave text-body-sm text-text-tertiary mt-1">
            or click to browse files
          </p>
        </div>
        <Button
          variant="default"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
        >
          Browse Files
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileChange}
      />

      {fileName && !error && (
        <p className="font-mohave text-body-sm text-text-secondary">
          Selected: {fileName}
        </p>
      )}

      {error && (
        <p className="font-mohave text-body-sm text-ops-error">{error}</p>
      )}
    </div>
  );
}
