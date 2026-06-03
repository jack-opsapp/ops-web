import { describe, expect, it } from "vitest";
import en from "@/i18n/dictionaries/en/accounting.json";
import es from "@/i18n/dictionaries/es/accounting.json";

const REQUIRED_QBO_KEYS = [
  "tabs.import",
  "qbo.title",
  "qbo.readOnlyNote",
  "qbo.pull",
  "qbo.pulling",
  "qbo.lastPulled",
  "qbo.never",
  "qbo.notConnected",
  "qbo.connectFirst",
  "qbo.writeCalls",
  "qbo.writeCallsOk",
  "qbo.writeCallsFail",
  "qbo.recon.title",
  "qbo.recon.quickbooks",
  "qbo.recon.ops",
  "qbo.recon.openAr",
  "qbo.recon.openInvoices",
  "qbo.recon.collected24mo",
  "qbo.recon.customers",
  "qbo.recon.delta",
  "qbo.customers.title",
  "qbo.customers.action",
  "qbo.customers.basis",
  "qbo.customers.confidence",
  "qbo.customers.match",
  "qbo.action.link",
  "qbo.action.create",
  "qbo.action.skip",
  "qbo.action.needs_review",
  "qbo.basis.email",
  "qbo.basis.name_exact",
  "qbo.basis.name_fuzzy",
  "qbo.basis.none",
  "qbo.confidence.high",
  "qbo.confidence.medium",
  "qbo.confidence.low",
  "qbo.candidate.none",
  "qbo.records.title",
  "qbo.records.estimates",
  "qbo.records.invoices",
  "qbo.records.payments",
  "qbo.records.lineItems",
  "qbo.records.skippedInvoices",
  "qbo.records.orphanPayments",
  "qbo.apply.all",
  "qbo.apply.applying",
  "qbo.applied",
  "qbo.applyConfirm",
  "qbo.needsReviewBlock",
  "qbo.empty.noRun",
  "qbo.empty.startPrompt",
  "qbo.error",
  "qbo.notify.title",
  "qbo.notify.body",
  "qbo.notify.action",
];

describe("accounting dictionary qbo keys", () => {
  it("en has every qbo key", () => {
    for (const k of REQUIRED_QBO_KEYS) {
      expect(en, `missing en key ${k}`).toHaveProperty([k]);
    }
  });
  it("es mirrors en exactly (no missing/extra keys)", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });
});
