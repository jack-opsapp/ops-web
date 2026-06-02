// tests/fixtures/qbo/apply-run.fixture.ts
export const TEMP_COMPANY_ID = "a612edc0-5c18-4c4d-af97-55b9410dd077";
export const RUN_ID = "99999999-0000-4000-8000-000000000001";

export const stagedCustomers = [
  {
    id: "sc-1", run_id: RUN_ID, company_id: TEMP_COMPANY_ID,
    qb_id: "QB-CUST-1", display_name: "Acme Decks", email: "ap@acmedecks.test",
    phone: "555-0100", address: "1 Cedar Way, Vancouver BC V5K0A1", active: true, raw: {},
  },
];

export const stagedEstimates = [
  {
    id: "se-1", run_id: RUN_ID, company_id: TEMP_COMPANY_ID,
    qb_id: "QB-EST-1", doc_number: "E-1001", customer_qb_id: "QB-CUST-1",
    txn_date: "2026-03-01", expiration_date: "2026-04-01", txn_status: "Accepted",
    subtotal: 335.25, tax_amount: 26.82, tax_rate: 8, total: 362.07, raw: {},
  },
];

export const stagedInvoices = [
  {
    id: "si-1", run_id: RUN_ID, company_id: TEMP_COMPANY_ID,
    qb_id: "QB-INV-1", doc_number: "1001", customer_qb_id: "QB-CUST-1",
    estimate_qb_id: "QB-EST-1", txn_date: "2026-03-05", due_date: "2026-04-05",
    subtotal: 335.25, tax_amount: 26.82, tax_rate: 8, total: 362.07,
    balance: 162.07, derived_status: "partially_paid", raw: {},
  },
];

export const stagedLineItems = [
  {
    id: "sl-1", run_id: RUN_ID, company_id: TEMP_COMPANY_ID,
    parent_type: "invoice", parent_qb_id: "QB-INV-1", qb_line_id: "1",
    name: "Cedar deck boards", description: "Cedar deck boards",
    quantity: 47.05, unit_price: 5, amount: 235.25,
    is_taxable: true, qb_item_type: "NonInventory", sort_order: 0,
  },
  {
    id: "sl-2", run_id: RUN_ID, company_id: TEMP_COMPANY_ID,
    parent_type: "invoice", parent_qb_id: "QB-INV-1", qb_line_id: "2",
    name: "Labor", description: "Install labor",
    quantity: 1, unit_price: 100, amount: 100,
    is_taxable: true, qb_item_type: "Service", sort_order: 1,
  },
];

export const stagedPayments = [
  {
    id: "sp-1", run_id: RUN_ID, company_id: TEMP_COMPANY_ID,
    qb_id: "QB-PMT-1", customer_qb_id: "QB-CUST-1", txn_date: "2026-03-20",
    total_amt: 200, unapplied_amt: 0,
    applied_lines: [{ invoice_qb_id: "QB-INV-1", amount: 200, reference_number: "CHK-77" }],
    raw: {},
  },
];

export const customerMatches = [
  {
    id: "cm-1", run_id: RUN_ID, company_id: TEMP_COMPANY_ID,
    customer_qb_id: "QB-CUST-1", proposed_action: "create",
    matched_client_id: null, match_basis: "none", confidence: "low",
    candidates: [], decided_action: null, decided_client_id: null,
  },
];

export const decisions = [
  { customer_qb_id: "QB-CUST-1", action: "create" as const },
];
