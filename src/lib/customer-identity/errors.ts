/**
 * Typed failures for the customer identity broker. Every error that can reach
 * a route carries a stable machine code and never a customer identifier: the
 * routes map codes to privacy-safe responses (design I5) and the codes are
 * the only thing a log line may quote.
 */

export type CustomerIdentityErrorCode =
  | "customer_identity_unavailable"
  | "customer_identity_store_failure"
  | "customer_identity_invalid_input"
  | "customer_contact_conflict"
  | "customer_access_denied";

export class CustomerIdentityError extends Error {
  readonly code: CustomerIdentityErrorCode;

  constructor(
    code: CustomerIdentityErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "CustomerIdentityError";
    this.code = code;
  }
}

/**
 * The customer auth project or the broker key ring is not configured. Every
 * broker entry point fails closed with this before touching any network.
 * `reason` distinguishes an intentionally blank deployment (pre-G1) from a
 * malformed one so operators can tell the two apart from a single log line.
 */
export class CustomerIdentityUnavailableError extends CustomerIdentityError {
  readonly reason: "blank" | "malformed";

  constructor(reason: "blank" | "malformed", detail: string) {
    super(
      "customer_identity_unavailable",
      `Customer identity is unavailable: ${detail}`
    );
    this.name = "CustomerIdentityUnavailableError";
    this.reason = reason;
  }
}

/** A system RPC failed or returned a row the contract does not allow. */
export class CustomerIdentityStoreError extends CustomerIdentityError {
  readonly operation: string;

  constructor(operation: string, options?: { cause?: unknown }) {
    super(
      "customer_identity_store_failure",
      `Customer identity store operation failed: ${operation}`,
      options
    );
    this.name = "CustomerIdentityStoreError";
    this.operation = operation;
  }
}

/** Caller-supplied input the broker refuses to act on (bad email, bad code). */
export class CustomerIdentityInputError extends CustomerIdentityError {
  readonly field: "email" | "code" | "challengeId" | "identityId" | "companyId";

  constructor(field: CustomerIdentityInputError["field"]) {
    super(
      "customer_identity_invalid_input",
      `Customer identity input is invalid: ${field}`
    );
    this.name = "CustomerIdentityInputError";
    this.field = field;
  }
}

/**
 * The verified email is already a live verified contact on another identity.
 * The database never silently moves a contact; the broker surfaces it as a
 * typed failure so the route can answer without confirming anything exists.
 */
export class CustomerContactConflictError extends CustomerIdentityError {
  constructor() {
    super(
      "customer_contact_conflict",
      "Verified contact belongs to another customer identity"
    );
    this.name = "CustomerContactConflictError";
  }
}

export type CustomerAccessDenialCode = "NOT_FOUND" | "FORWARD_ONLY" | "REVOKED";

/**
 * Membership gate failure. The denial code is privacy-safe by construction:
 * it says nothing about which client, contact or company record exists.
 */
export class CustomerAccessError extends CustomerIdentityError {
  readonly denial: CustomerAccessDenialCode;

  constructor(denial: CustomerAccessDenialCode) {
    super("customer_access_denied", `Customer access denied: ${denial}`);
    this.name = "CustomerAccessError";
    this.denial = denial;
  }
}
