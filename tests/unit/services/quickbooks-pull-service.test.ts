// tests/unit/services/quickbooks-pull-service.test.ts
import { describe, it, expect, vi } from "vitest";
import { QuickBooksPullService } from "@/lib/api/services/quickbooks-pull-service";
import type { QboPullResult } from "@/lib/types/qbo-import";

describe("QuickBooksPullService — host selection", () => {
  it("uses the production host only when QB_ENVIRONMENT==='production'", () => {
    const prod = new QuickBooksPullService("4620816365", "tok", "production");
    expect(prod.baseUrl).toBe("https://quickbooks.api.intuit.com/v3/company/4620816365");
  });

  it("uses the sandbox host for 'sandbox', unset, or any other value", () => {
    const sandbox = new QuickBooksPullService("4620816365", "tok", "sandbox");
    const fallback = new QuickBooksPullService("4620816365", "tok", undefined);
    const garbage = new QuickBooksPullService("4620816365", "tok", "staging");
    expect(sandbox.baseUrl).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/4620816365");
    expect(fallback.baseUrl).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/4620816365");
    expect(garbage.baseUrl).toBe("https://sandbox-quickbooks.api.intuit.com/v3/company/4620816365");
  });

  it("starts with qbWriteCalls at 0", () => {
    expect(new QuickBooksPullService("r", "t", "production").qbWriteCalls).toBe(0);
  });
});

describe("QuickBooksPullService — cutoff validation", () => {
  it("rejects a non-YYYY-MM-DD cutoff before issuing any request", async () => {
    const fetchSpy = vi.fn();
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    await expect(svc.pullInvoices("2024/01/01")).rejects.toThrow("Invalid cutoff date");
    await expect(svc.pullInvoices("garbage")).rejects.toThrow("Invalid cutoff date");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a valid YYYY-MM-DD cutoff (no throw on validation)", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ QueryResponse: {} }), { status: 200 })
    );
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    await expect(svc.pullInvoices("2024-06-01")).resolves.toBeInstanceOf(Array);
  });
});

// ── Real sandbox JSON shapes (trimmed to fields the import uses) ───────────

const SANDBOX_CUSTOMER = {
  Id: "1",
  DisplayName: "Amy's Bird Sanctuary",
  PrimaryEmailAddr: { Address: "Birds@Intuit.com" },
  PrimaryPhone: { FreeFormNumber: "(650) 555-3311" },
  BillAddr: { Line1: "4581 Finch St.", City: "Bayshore", CountrySubDivisionCode: "CA", PostalCode: "94326" },
  Active: true,
};

const SANDBOX_INVOICE_RECENT = {
  Id: "130",
  DocNumber: "1037",
  CustomerRef: { value: "1", name: "Amy's Bird Sanctuary" },
  TxnDate: "2024-09-01",
  DueDate: "2024-10-01",
  TotalAmt: 362.07,
  Balance: 0,
  Line: [
    {
      Id: "1",
      LineNum: 1,
      Description: "Rock Fountain",
      Amount: 275,
      DetailType: "SalesItemLineDetail",
      SalesItemLineDetail: { ItemRef: { value: "5", name: "Rock Fountain" }, Qty: 1, UnitPrice: 275, TaxCodeRef: { value: "TAX" } },
    },
    // trailing computed line present on every real invoice — must be skipped downstream
    { Amount: 335.25, DetailType: "SubTotalLineDetail", SubTotalLineDetail: {} },
  ],
  TxnTaxDetail: { TotalTax: 26.82, TaxLine: [{ Amount: 26.82, DetailType: "TaxLineDetail", TaxLineDetail: { TaxPercent: 8, NetAmountTaxable: 335.25 } }] },
};

const SANDBOX_INVOICE_OPEN = {
  Id: "131",
  DocNumber: "1038",
  CustomerRef: { value: "1" },
  TxnDate: "2020-01-15", // older than the 24mo window — only reached via Balance>0
  DueDate: "2020-02-15",
  TotalAmt: 100,
  Balance: 100,
  Line: [{ Id: "1", LineNum: 1, Description: "Services", Amount: 100, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { Qty: 1, UnitPrice: 100, TaxCodeRef: { value: "NON" } } }],
};

const SANDBOX_PAYMENT = {
  Id: "200",
  TotalAmt: 362.07,
  TxnDate: "2024-10-05",
  CustomerRef: { value: "1" },
  PaymentRefNum: "CHK-9981",
  UnappliedAmt: 0,
  Line: [{ Amount: 362.07, LinkedTxn: [{ TxnId: "130", TxnType: "Invoice" }] }],
};

const SANDBOX_ESTIMATE = {
  Id: "300",
  DocNumber: "EST-7",
  CustomerRef: { value: "1" },
  TxnDate: "2024-08-01",
  ExpirationDate: "2024-09-01",
  TxnStatus: "Accepted",
  TotalAmt: 362.07,
  Line: [{ Id: "1", LineNum: 1, Description: "Rock Fountain", Amount: 275, DetailType: "SalesItemLineDetail", SalesItemLineDetail: { Qty: 1, UnitPrice: 275 } }],
};

const SANDBOX_ITEM = { Id: "5", Name: "Rock Fountain", Type: "NonInventory" };

/**
 * Build a fetch spy that records every request and answers QBO queries based
 * on the SQL in the `query=` param. `pages` optionally returns multiple pages
 * for an entity to exercise STARTPOSITION pagination.
 */
function makeQboFetch(opts: {
  pages?: Record<string, Array<Array<Record<string, unknown>>>>; // entityKey -> array of pages
  single?: Record<string, Array<Record<string, unknown>>>; // entityKey -> one page
}) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });

    const sql = decodeURIComponent(new URL(url).searchParams.get("query") ?? "");
    const startMatch = sql.match(/STARTPOSITION (\d+)/);
    const start = startMatch ? Number(startMatch[1]) : 1;
    const pageIndex = Math.floor((start - 1) / 1000);

    const entityKey =
      /FROM Customer/.test(sql) ? "Customer" :
      /FROM Invoice/.test(sql) ? "Invoice" :
      /FROM Estimate/.test(sql) ? "Estimate" :
      /FROM Payment/.test(sql) ? "Payment" :
      /FROM Item/.test(sql) ? "Item" : "Unknown";

    let rows: Array<Record<string, unknown>> = [];
    if (opts.pages?.[entityKey]) {
      rows = opts.pages[entityKey][pageIndex] ?? [];
    } else if (opts.single?.[entityKey]) {
      // Invoice fires twice (recent + open); disambiguate by the WHERE clause.
      if (entityKey === "Invoice" && /Balance > '0'/.test(sql)) {
        rows = (opts.single["Invoice_open"] as Array<Record<string, unknown>>) ?? [];
      } else {
        rows = opts.single[entityKey] ?? [];
      }
    }
    return new Response(JSON.stringify({ QueryResponse: { [entityKey]: rows } }), { status: 200 });
  });
  return { calls, fetchSpy };
}

describe("QuickBooksPullService — read-only invariant (GET only)", () => {
  it("issues ONLY GET requests across every pull method and never increments qbWriteCalls", async () => {
    const { calls, fetchSpy } = makeQboFetch({
      single: {
        Customer: [SANDBOX_CUSTOMER],
        Invoice: [SANDBOX_INVOICE_RECENT],
        Invoice_open: [SANDBOX_INVOICE_OPEN],
        Estimate: [SANDBOX_ESTIMATE],
        Payment: [SANDBOX_PAYMENT],
        Item: [SANDBOX_ITEM],
      },
    });
    const svc = new QuickBooksPullService("4620816365", "tok", "production", fetchSpy as unknown as typeof fetch);

    await svc.pullCustomers();
    await svc.pullInvoices("2022-06-01");
    await svc.pullEstimates("2022-06-01");
    await svc.pullPayments("2022-06-01");
    await svc.pullItems();

    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.method).toBe("GET");
      expect(c.url).toContain("/query?query=");
    }
    // The defining safety assertion: nothing was ever written to QuickBooks.
    expect(svc.qbWriteCalls).toBe(0);
  });

  it("targets the correct production query endpoint", async () => {
    const { calls, fetchSpy } = makeQboFetch({ single: { Customer: [SANDBOX_CUSTOMER] } });
    const svc = new QuickBooksPullService("4620816365", "tok", "production", fetchSpy as unknown as typeof fetch);
    await svc.pullCustomers();
    expect(calls[0].url.startsWith("https://quickbooks.api.intuit.com/v3/company/4620816365/query")).toBe(true);
  });

  it("omits minorversion from the request URL", async () => {
    const { calls, fetchSpy } = makeQboFetch({ single: { Customer: [SANDBOX_CUSTOMER] } });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    await svc.pullCustomers();
    expect(calls[0].url).not.toContain("minorversion");
  });
});

describe("QuickBooksPullService — invoice window (open OR last-24mo, deduped)", () => {
  it("fires a recent-by-TxnDate query AND an open-by-Balance query, deduped by Id", async () => {
    const { calls, fetchSpy } = makeQboFetch({
      single: { Invoice: [SANDBOX_INVOICE_RECENT], Invoice_open: [SANDBOX_INVOICE_OPEN] },
    });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);

    const invoices = await svc.pullInvoices("2022-06-01");

    const sqls = calls.map((c) => decodeURIComponent(new URL(c.url).searchParams.get("query")!));
    expect(sqls.some((s) => /WHERE TxnDate >= '2022-06-01'/.test(s))).toBe(true);
    expect(sqls.some((s) => /WHERE Balance > '0'/.test(s))).toBe(true);
    // recent (130) + open (131), both distinct Ids
    expect(invoices.map((i) => i.Id).sort()).toEqual(["130", "131"]);
  });

  it("dedupes an invoice that appears in BOTH queries (same Id once)", async () => {
    const { fetchSpy } = makeQboFetch({
      // 130 is both recent and open → appears in each query, must collapse to one
      single: { Invoice: [SANDBOX_INVOICE_RECENT], Invoice_open: [SANDBOX_INVOICE_RECENT] },
    });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    const invoices = await svc.pullInvoices("2022-06-01");
    expect(invoices).toHaveLength(1);
    expect(invoices[0].Id).toBe("130");
  });
});

describe("QuickBooksPullService — pagination", () => {
  it("walks STARTPOSITION until a short page, concatenating all rows", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({ Id: `c${i}`, DisplayName: `Cust ${i}` }));
    const lastPage = [{ Id: "c1000", DisplayName: "Cust 1000" }];
    const { calls, fetchSpy } = makeQboFetch({ pages: { Customer: [fullPage, lastPage] } });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);

    const customers = await svc.pullCustomers();

    expect(customers).toHaveLength(1001);
    // page 1 STARTPOSITION 1, page 2 STARTPOSITION 1001
    const positions = calls.map((c) => decodeURIComponent(new URL(c.url).searchParams.get("query")!).match(/STARTPOSITION (\d+)/)![1]);
    expect(positions).toEqual(["1", "1001"]);
  });

  it("stops after a single page when fewer than MAXRESULTS rows return", async () => {
    const { calls, fetchSpy } = makeQboFetch({ single: { Customer: [SANDBOX_CUSTOMER] } });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    await svc.pullCustomers();
    expect(calls).toHaveLength(1);
  });
});

describe("QuickBooksPullService — passthrough fidelity (real sandbox shapes survive)", () => {
  it("returns raw Customer with PrimaryEmailAddr/BillAddr intact for downstream mapping", async () => {
    const { fetchSpy } = makeQboFetch({ single: { Customer: [SANDBOX_CUSTOMER] } });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    const [c] = await svc.pullCustomers();
    expect((c.PrimaryEmailAddr as { Address: string }).Address).toBe("Birds@Intuit.com");
    expect((c.BillAddr as { Line1: string }).Line1).toBe("4581 Finch St.");
  });

  it("returns raw Payment with Line[].LinkedTxn intact", async () => {
    const { fetchSpy } = makeQboFetch({ single: { Payment: [SANDBOX_PAYMENT] } });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    const [p] = await svc.pullPayments("2022-06-01");
    const line = (p.Line as Array<{ LinkedTxn: Array<{ TxnId: string; TxnType: string }> }>)[0];
    expect(line.LinkedTxn[0]).toEqual({ TxnId: "130", TxnType: "Invoice" });
  });

  it("returns raw Invoice with trailing SubTotalLineDetail line present (to be skipped downstream)", async () => {
    const { fetchSpy } = makeQboFetch({ single: { Invoice: [SANDBOX_INVOICE_RECENT], Invoice_open: [] } });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    const [inv] = await svc.pullInvoices("2022-06-01");
    const lines = inv.Line as Array<{ DetailType: string }>;
    expect(lines.some((l) => l.DetailType === "SubTotalLineDetail")).toBe(true);
  });
});

describe("QuickBooksPullService — error surface", () => {
  it("throws on a non-OK QBO response with status + body", async () => {
    const fetchSpy = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);
    await expect(svc.pullCustomers()).rejects.toThrow("QuickBooks pull error (401): unauthorized");
    expect(svc.qbWriteCalls).toBe(0);
  });
});

describe("QuickBooksPullService — pullAll aggregate", () => {
  it("pullAll returns every entity array plus the write-call counter", async () => {
    const { fetchSpy } = makeQboFetch({
      single: {
        Customer: [SANDBOX_CUSTOMER],
        Invoice: [SANDBOX_INVOICE_RECENT],
        Invoice_open: [],
        Estimate: [SANDBOX_ESTIMATE],
        Payment: [SANDBOX_PAYMENT],
        Item: [SANDBOX_ITEM],
      },
    });
    const svc = new QuickBooksPullService("r", "t", "production", fetchSpy as unknown as typeof fetch);

    const result: QboPullResult = await svc.pullAll("2022-06-01");

    expect(result.customers).toHaveLength(1);
    expect(result.invoices).toHaveLength(1);
    expect(result.estimates).toHaveLength(1);
    expect(result.payments).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    expect(result.qbWriteCalls).toBe(0);
  });
});
