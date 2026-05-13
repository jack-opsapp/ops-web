/**
 * Coverage for `ProjectFileService.listClientDocuments` — the merge +
 * sort logic that powers the inbox right-rail Documents section.
 *
 * The Supabase client is stubbed via vi.mock so we can drive each
 * branch (estimates only / invoices only / both / errors) without a
 * live DB connection.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = {
  estimates: [] as unknown[],
  invoices: [] as unknown[],
  estimateError: null as { message: string } | null,
  invoiceError: null as { message: string } | null,
};

vi.mock("@/lib/supabase/helpers", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/supabase/helpers")
  >("@/lib/supabase/helpers");
  return {
    ...actual,
    requireSupabase: () => ({
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () =>
                  Promise.resolve(
                    table === "estimates"
                      ? {
                          data: supabaseMock.estimates,
                          error: supabaseMock.estimateError,
                        }
                      : {
                          data: supabaseMock.invoices,
                          error: supabaseMock.invoiceError,
                        },
                  ),
              }),
            }),
          }),
        }),
      }),
    }),
  };
});

beforeEach(() => {
  supabaseMock.estimates = [];
  supabaseMock.invoices = [];
  supabaseMock.estimateError = null;
  supabaseMock.invoiceError = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

async function load() {
  // Dynamic import so the vi.mock above is honored.
  const mod = await import("@/lib/api/services/project-file-service");
  return mod.ProjectFileService;
}

describe("ProjectFileService.listClientDocuments", () => {
  it("returns [] when clientId or companyId is missing", async () => {
    const svc = await load();
    expect(await svc.listClientDocuments("", "co")).toEqual([]);
    expect(await svc.listClientDocuments("client", "")).toEqual([]);
  });

  it("returns mapped estimates", async () => {
    supabaseMock.estimates = [
      {
        id: "est-1",
        estimate_number: "1042",
        status: "sent",
        pdf_storage_path: "https://s3/estimate-1042.pdf",
        updated_at: "2026-05-07T12:00:00Z",
        total: 1042.5,
      },
    ];
    const svc = await load();
    const out = await svc.listClientDocuments("client", "co");
    expect(out).toEqual([
      {
        id: "estimate:est-1",
        filename: "Estimate 1042.pdf",
        sourceType: "estimate",
        sourceId: "est-1",
        status: "sent",
        pdfStoragePath: "https://s3/estimate-1042.pdf",
        updatedAt: "2026-05-07T12:00:00.000Z",
        value: 1042.5,
      },
    ]);
  });

  it("returns mapped invoices", async () => {
    supabaseMock.invoices = [
      {
        id: "inv-2",
        invoice_number: "2026-9001",
        status: "paid",
        pdf_storage_path: null,
        updated_at: "2026-05-06T08:00:00Z",
        total: "9001.99",
      },
    ];
    const svc = await load();
    const out = await svc.listClientDocuments("client", "co");
    expect(out).toEqual([
      {
        id: "invoice:inv-2",
        filename: "Invoice 2026-9001.pdf",
        sourceType: "invoice",
        sourceId: "inv-2",
        status: "paid",
        pdfStoragePath: null,
        updatedAt: "2026-05-06T08:00:00.000Z",
        value: 9001.99,
      },
    ]);
  });

  it("coerces missing or unparseable totals to null", async () => {
    supabaseMock.estimates = [
      {
        id: "est-no-total",
        estimate_number: "9",
        status: "draft",
        pdf_storage_path: null,
        updated_at: "2026-05-07T12:00:00Z",
        // total intentionally omitted — fresh-draft path
      },
      {
        id: "est-bad-total",
        estimate_number: "10",
        status: "draft",
        pdf_storage_path: null,
        updated_at: "2026-05-06T12:00:00Z",
        total: "not-a-number",
      },
    ];
    const svc = await load();
    const out = await svc.listClientDocuments("client", "co");
    expect(out.map((d) => d.value)).toEqual([null, null]);
  });

  it("merges and sorts both sources newest-first", async () => {
    supabaseMock.estimates = [
      {
        id: "est-old",
        estimate_number: "100",
        status: "sent",
        pdf_storage_path: null,
        updated_at: "2026-04-01T10:00:00Z",
      },
      {
        id: "est-new",
        estimate_number: "101",
        status: "draft",
        pdf_storage_path: null,
        updated_at: "2026-05-07T11:00:00Z",
      },
    ];
    supabaseMock.invoices = [
      {
        id: "inv-mid",
        invoice_number: "5000",
        status: "paid",
        pdf_storage_path: null,
        updated_at: "2026-05-05T09:00:00Z",
      },
    ];
    const svc = await load();
    const out = await svc.listClientDocuments("client", "co");
    expect(out.map((d) => d.id)).toEqual([
      "estimate:est-new",
      "invoice:inv-mid",
      "estimate:est-old",
    ]);
  });

  it("falls back to short-id filename when number is missing", async () => {
    supabaseMock.estimates = [
      {
        id: "abcdef12-3456-7890-aaaa-bbbbccccdddd",
        estimate_number: null,
        status: "draft",
        pdf_storage_path: null,
        updated_at: "2026-05-07T12:00:00Z",
      },
    ];
    const svc = await load();
    const out = await svc.listClientDocuments("client", "co");
    expect(out[0].filename).toBe("Estimate abcdef12.pdf");
  });

  it("survives a partial source error and returns the healthy half", async () => {
    supabaseMock.estimateError = { message: "boom" };
    supabaseMock.invoices = [
      {
        id: "inv-1",
        invoice_number: "9001",
        status: "paid",
        pdf_storage_path: null,
        updated_at: "2026-05-07T12:00:00Z",
      },
    ];
    const svc = await load();
    const out = await svc.listClientDocuments("client", "co");
    expect(out.map((d) => d.id)).toEqual(["invoice:inv-1"]);
  });

  it("respects the limit parameter on the merged result", async () => {
    supabaseMock.estimates = Array.from({ length: 3 }, (_, i) => ({
      id: `est-${i}`,
      estimate_number: String(i),
      status: "sent",
      pdf_storage_path: null,
      updated_at: `2026-05-0${i + 1}T10:00:00Z`,
    }));
    supabaseMock.invoices = Array.from({ length: 3 }, (_, i) => ({
      id: `inv-${i}`,
      invoice_number: String(i),
      status: "paid",
      pdf_storage_path: null,
      updated_at: `2026-05-0${i + 5}T10:00:00Z`,
    }));
    const svc = await load();
    const out = await svc.listClientDocuments("client", "co", 4);
    expect(out).toHaveLength(4);
    // Newest-first ordering preserved through the limit slice.
    expect(out[0].id).toBe("invoice:inv-2");
  });
});
