/**
 * OPS Web - CSV Export Utility
 *
 * Generates and downloads a CSV file from structured data.
 */

export interface CsvColumn<T> {
  key: keyof T;
  header: string;
}

export function exportToCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: CsvColumn<T>[],
  filename: string
) {
  const header = columns.map((c) => escapeCsvValue(c.header)).join(",");

  const rows = data.map((row) =>
    columns
      .map((c) => {
        const val = row[c.key];
        if (val === null || val === undefined) return "";
        if (val instanceof Date) {
          return escapeCsvValue(val.toISOString());
        }
        return escapeCsvValue(String(val));
      })
      .join(",")
  );

  const csv = [header, ...rows].join("\n");
  const bom = "\uFEFF"; // UTF-8 BOM for Excel compatibility
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();

  // Cleanup
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeCsvValue(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
