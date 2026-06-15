import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/i18n/client", () => ({
  useDictionary: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    dict: {},
  }),
  useLocale: () => ({ locale: "en", setLocale: vi.fn() }),
}));

import { UploadPane, type UploadPaneOutcome } from "../UploadPane";

function selectFile(name = "pricelist.csv", type = "text/csv") {
  const input = screen.getByTestId("upload-input") as HTMLInputElement;
  const file = new File(["Name,Price\nWidget,10\n"], name, { type });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe("<UploadPane>", () => {
  it("renders the dropzone + a hidden file input by default", () => {
    render(<UploadPane onUpload={async () => ({ kind: "cant_read" })} />);
    expect(screen.getByTestId("upload-dropzone")).toBeInTheDocument();
    expect(screen.getByTestId("upload-input")).toBeInTheDocument();
  });

  it("hands the selected file to onUpload and renders the staged summary", async () => {
    const onUpload = vi.fn(
      async (_file: File): Promise<UploadPaneOutcome> => ({
        kind: "staged",
        staged: 2,
        merged: 1,
        rowsRead: 2,
      }),
    );
    render(<UploadPane onUpload={onUpload} />);
    const file = selectFile();

    await waitFor(() => expect(screen.getByTestId("upload-staged")).toBeInTheDocument());
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onUpload.mock.calls[0][0]).toBe(file);
    // The merged count surfaces so the owner knows duplicates were matched.
    expect(screen.getByTestId("upload-merged")).toBeInTheDocument();
  });

  it("surfaces mapper errors and stages nothing", async () => {
    render(
      <UploadPane
        onUpload={async () => ({
          kind: "errors",
          errors: ["Line 2: base_price is required."],
        })}
      />,
    );
    selectFile();

    await waitFor(() => expect(screen.getByTestId("upload-errors")).toBeInTheDocument());
    expect(screen.getByTestId("upload-error-row")).toHaveTextContent(/base_price/i);
  });

  it("rejects an oversized file before reading it (size guard)", async () => {
    const onUpload = vi.fn(async (): Promise<UploadPaneOutcome> => ({ kind: "cant_read" }));
    render(<UploadPane onUpload={onUpload} />);
    const input = screen.getByTestId("upload-input") as HTMLInputElement;
    const big = new File(["x"], "huge.csv", { type: "text/csv" });
    Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });

    await waitFor(() => expect(screen.getByTestId("upload-too-large")).toBeInTheDocument());
    expect(onUpload).not.toHaveBeenCalled(); // never read/parsed
  });

  it("offers a manual escape when a file can't be auto-read", async () => {
    const onAddManually = vi.fn();
    render(
      <UploadPane
        onUpload={async () => ({ kind: "cant_read" })}
        onAddManually={onAddManually}
      />,
    );
    selectFile("scan.pdf", "application/pdf");

    await waitFor(() => expect(screen.getByTestId("upload-cant-read")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("upload-add-manually"));
    expect(onAddManually).toHaveBeenCalledTimes(1);
  });

  it("lets the owner upload another file after a result (resets to the dropzone)", async () => {
    render(
      <UploadPane
        onUpload={async () => ({ kind: "staged", staged: 1, merged: 0, rowsRead: 1 })}
      />,
    );
    selectFile();
    await waitFor(() => expect(screen.getByTestId("upload-staged")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("upload-another"));
    await waitFor(() => expect(screen.getByTestId("upload-dropzone")).toBeInTheDocument());
  });

  it("fires onBack", () => {
    const onBack = vi.fn();
    render(<UploadPane onUpload={async () => ({ kind: "cant_read" })} onBack={onBack} />);
    fireEvent.click(screen.getByTestId("upload-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
