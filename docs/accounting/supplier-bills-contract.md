# Supplier bills / accounts payable contract

This is the production accounting prerequisite for later assistant workflows. It is intentionally a narrow Accounting service contract: no MCP tool, vinyl-order behavior, or Invisible Office sequencing is implemented here.

## Boundary

- Current Firebase actor authentication is required at the HTTP boundary.
- PostgreSQL re-resolves the active actor, company, `expenses.approve`, and `accounting.view` authority during both prepare and commit.
- Capture, settlement, and voiding use `prepare_supplier_bill_write` followed by an exact confirmation string and `commit_supplier_bill_write`.
- The RPCs are executable only by `service_role`; authenticated clients receive company-scoped read access and cannot call the write functions directly.
- Every successful commit returns a fresh database readback. `replayed` is `false` for the first successful commit and `true` only for a committed idempotent replay.

## HTTP entry points

### Prepare a captured supplier document

`POST /api/internal/accounting/supplier-bills/prepare`

Send `multipart/form-data` with:

- `command`: JSON capture draft.
- `document`: the original PDF, maximum 20 MB.

The server verifies the PDF signature and EOF marker, computes SHA-256, writes the bytes once to an AES-256 server-encrypted S3 object under the authenticated company and stable request ID, then passes the canonical custody descriptor to PostgreSQL. Callers cannot supply their own capture URL through the JSON action path.

The capture draft contains:

```json
{
  "requestId": "uuid",
  "idempotencyKey": "stable caller key",
  "supplier": {
    "displayName": "Supplier name",
    "email": null,
    "phone": null,
    "taxNumber": null
  },
  "invoiceNumber": "INV-100",
  "invoiceDate": "2026-09-01",
  "dueDate": null,
  "currency": "CAD",
  "categoryId": "uuid",
  "subtotal": "100.00",
  "taxTotal": "5.00",
  "total": "105.00",
  "balance": "105.00",
  "notes": null,
  "lineItems": [
    {
      "position": 1,
      "sku": null,
      "description": "Material",
      "quantity": "1",
      "unitPrice": "100.00",
      "subtotal": "100.00",
      "taxAmount": "5.00",
      "total": "105.00",
      "categoryId": null,
      "allocations": [{ "projectId": "uuid", "amount": "105.00" }]
    }
  ],
  "paidPurchase": null
}
```

Money is transported as two-decimal strings. Line subtotal plus tax must equal line total, all lines must equal the document totals, and every line must be allocated exactly across same-company projects. A missing due date remains `null`; OPS never invents one.

An unpaid document must have `balance = total` and routes to a canonical `supplier_bill`. A zero-balance document must provide `paidPurchase` (`expenseId`, `paidDate`, and the existing expense payment method) and routes through `save_expense_atomic`. Partially settled opening documents are rejected; capture the bill, then record its payment history.

### Prepare a payment or void

The same prepare endpoint accepts JSON only for these actions:

```json
{
  "kind": "record_payment",
  "idempotencyKey": "stable caller key",
  "billId": "uuid",
  "payment": {
    "paymentDate": "2026-09-03",
    "amount": "40.00",
    "paymentMethod": "eft",
    "reference": "EFT-100"
  }
}
```

```json
{
  "kind": "void",
  "idempotencyKey": "stable caller key",
  "billId": "uuid",
  "reason": "Duplicate supplier document"
}
```

Payments cannot exceed the locked live balance. A bill with recorded payments cannot be voided. Lifecycle is derived in the commit transaction: `open → partial → paid`; an unsettled bill may become `void`.

### Commit

`POST /api/internal/accounting/supplier-bills/commit`

```json
{
  "intentId": "uuid returned by prepare",
  "confirmationText": "exact string returned by prepare"
}
```

Prepared intents expire after 15 minutes. Reusing an idempotency key with different content or a different actor fails. An expired, unchanged intent can be freshly prepared under the same stable key.

## Durable data

The canonical model is `suppliers`, `supplier_bills`, `supplier_bill_line_items`, `supplier_bill_project_allocations`, `supplier_bill_payments`, `supplier_bill_documents`, `supplier_bill_events`, and provider mapping/link tables. Company-bound foreign keys protect bill, line, payment, and document ownership. Project-allocation tenant ownership is rechecked inside the write RPC before any allocation is inserted. Duplicate active invoices are rejected by company + supplier + normalized invoice number; duplicate source PDFs are rejected by company + SHA-256.

Each commit also writes a deduplicated Accounting notification and an append-only before/after event. Unpaid bills enqueue the supplier first and the bill second. Settlement enqueues a bill payment. Paid purchases remain in the existing expense approval/allocation system.

## Provider mapping

- QuickBooks: supplier → `Vendor`, unpaid obligation → `Bill`, settlement → `BillPayment`. Category, tax, payment-account, and project/job mappings must exist. A single OPS line allocated across jobs is split into exact-cent QBO expense lines with `CustomerRef`; missing mappings stop at `needs_review`. Stable queue IDs are sent as Intuit `requestid` values.
- Sage Accounting 3.1: supplier → vendor `Contact`, unpaid obligation → `PurchaseInvoice`, settlement → `ContactPayment` with an allocation to the purchase invoice. Sage requires a due date, ledger account, tax rate, and payment bank-account mapping; missing values stop at `needs_review`. OPS project allocations remain canonical in OPS because Sage Business Cloud Accounting does not expose a verified equivalent job reference in this contract.
- Zero-balance documents do not become provider bills; they continue through the existing paid purchase / expense path.

Provider completion is finalized by one database RPC that atomically stores the provider link and marks the claimed queue row succeeded. A successful provider write followed by failed OPS finalization is held at `needs_review`, never reported as synced.

## Fixture proof

The three DeksMart source PDFs used to shape this contract remain external test inputs and are not committed. They cover one-job and two-job unpaid invoices, including a document above CAD 10,000 and documents with no printed due date. Tests use synthetic equivalents without customer addresses or production documents.
