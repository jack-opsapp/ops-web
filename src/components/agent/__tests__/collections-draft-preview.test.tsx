import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CollectionsDraftPreview as Preview } from "@/lib/agent-control-plane/contracts/collections";
import { CollectionsDraftPreview } from "../collections-draft-preview";

const preview: Preview = {
  schema_revision: "2026-08-31.v1",
  metric_definition_revision: "collections-aging:2026-08-31.v1",
  as_of_date: "2026-08-31",
  customer_ref: {
    kind: "client",
    id: "11111111-1111-4111-8111-111111111111",
  },
  customer_display_name: "Northline Mechanical",
  recipient: {
    state: "ready",
    contact_ref: {
      kind: "client",
      id: "11111111-1111-4111-8111-111111111111",
    },
    display_name: "Morgan Lee",
    address: "morgan@northline.example",
  },
  invoices: [
    {
      invoice_ref: {
        kind: "invoice",
        id: "22222222-2222-4222-8222-222222222222",
      },
      document_number: "INV-1042",
      status: "past_due",
      issue_date: "2026-05-01",
      due_date: "2026-05-31",
      days_past_due: 92,
      aging_bucket: "91_plus",
      balance_due: { currency: "CAD", amount_minor: 125050 },
      evidence_ref: "evidence:invoice:22222222-2222-4222-8222-222222222222",
      content_kind: "untrusted_business_data",
    },
    {
      invoice_ref: {
        kind: "invoice",
        id: "33333333-3333-4333-8333-333333333333",
      },
      document_number: "INV-1059",
      status: "partially_paid",
      issue_date: "2026-07-01",
      due_date: "2026-07-31",
      days_past_due: 31,
      aging_bucket: "31_60",
      balance_due: { currency: "USD", amount_minor: 40000 },
      evidence_ref: "evidence:invoice:33333333-3333-4333-8333-333333333333",
      content_kind: "untrusted_business_data",
    },
  ],
  balances: [
    {
      currency: "CAD",
      amount_minor: 125050,
      invoice_count: 1,
      buckets: {
        current: { amount_minor: 0, invoice_count: 0 },
        "1_30": { amount_minor: 0, invoice_count: 0 },
        "31_60": { amount_minor: 0, invoice_count: 0 },
        "61_90": { amount_minor: 0, invoice_count: 0 },
        "91_plus": { amount_minor: 125050, invoice_count: 1 },
      },
    },
    {
      currency: "USD",
      amount_minor: 40000,
      invoice_count: 1,
      buckets: {
        current: { amount_minor: 0, invoice_count: 0 },
        "1_30": { amount_minor: 0, invoice_count: 0 },
        "31_60": { amount_minor: 40000, invoice_count: 1 },
        "61_90": { amount_minor: 0, invoice_count: 0 },
        "91_plus": { amount_minor: 0, invoice_count: 0 },
      },
    },
  ],
  oldest_due_date: "2026-05-31",
  max_days_past_due: 92,
  escalation_tier: "91_plus",
  subject: "Outstanding invoices — Northline Mechanical",
  body: "Morgan, our records show two outstanding invoices. Please reply with a firm payment date, or let us know if either invoice needs to be resent.",
  truth_boundary:
    "Draft approved inside OPS only. No message sent. No money moved. No financial document issued.",
};

const labels = {
  reviewHeading: "Collection draft",
  notSent: "NOT SENT",
  recipient: "Recipient",
  asOf: "As of",
  oldestDue: "Oldest due",
  daysPastDue: "Days past due",
  balances: "Outstanding",
  invoices: "Invoices",
  invoice: "Invoice",
  due: "Due",
  aging: "Aging",
  balance: "Balance",
  subject: "Subject",
  body: "Body",
  approvalSeal: "Immutable approval seal",
};

describe("collections draft preview", () => {
  it("shows the exact immutable debtor package and no delivery control", () => {
    render(
      <CollectionsDraftPreview
        preview={preview}
        previewSha256={`sha256:${"a".repeat(64)}`}
        locale="en-CA"
        labels={labels}
      />
    );

    for (const text of [
      "Northline Mechanical",
      "Morgan Lee",
      "morgan@northline.example",
      "INV-1042",
      "INV-1059",
      "2026-05-31",
      "92",
      "$1,250.50",
      "US$400.00",
      "Outstanding invoices — Northline Mechanical",
      preview.body,
      "NOT SENT",
      preview.truth_boundary,
      `sha256:${"a".repeat(64)}`,
    ]) {
      expect(
        screen.getAllByText(text, { exact: false }).length
      ).toBeGreaterThan(0);
    }
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /send/i })
    ).not.toBeInTheDocument();
  });
});
