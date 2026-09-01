import "server-only";

import type { CustomerIdentityDeps } from "./config";
import { CustomerAccessError, CustomerIdentityInputError } from "./errors";
import {
  resolveMembershipRow,
  type MembershipOutcome,
  type MembershipState,
} from "./rpc";
import type { CustomerSession } from "./session";

/**
 * Company-scoped membership (design §5.3, I2, I3). Resolution runs inside the
 * database under the company/email advisory lock; this module projects the
 * result to a route-safe shape. The company-owned client ids stay behind the
 * boundary: nothing here returns them, so a route cannot leak what it never
 * received.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface CustomerMembership {
  readonly membershipId: string;
  readonly state: MembershipState;
  readonly outcome: MembershipOutcome;
}

export async function resolveMembership(
  deps: CustomerIdentityDeps,
  identityId: string,
  companyId: string
): Promise<CustomerMembership | null> {
  if (typeof identityId !== "string" || !UUID_PATTERN.test(identityId)) {
    throw new CustomerIdentityInputError("identityId");
  }
  if (typeof companyId !== "string" || !UUID_PATTERN.test(companyId)) {
    throw new CustomerIdentityInputError("companyId");
  }
  const row = await resolveMembershipRow(deps.rpc, { identityId, companyId });
  if (row === null) return null;
  return Object.freeze({
    membershipId: row.membership_id,
    state: row.state,
    outcome: row.outcome,
  });
}

/**
 * Authority gate for a request. Re-resolves on every call — nothing is cached
 * from the session — and denies with a code that names no record:
 * NOT_FOUND (no live membership), REVOKED (the company withdrew access),
 * FORWARD_ONLY (history requested before company evidence exists).
 */
export async function requireMembership(
  deps: CustomerIdentityDeps,
  session: CustomerSession,
  companyId: string,
  options: { readonly needFullHistory: boolean }
): Promise<CustomerMembership> {
  const membership = await resolveMembership(deps, session.identityId, companyId);
  if (membership === null) throw new CustomerAccessError("NOT_FOUND");
  switch (membership.state) {
    case "revoked":
      throw new CustomerAccessError("REVOKED");
    case "merged":
      throw new CustomerAccessError("NOT_FOUND");
    case "active_forward_only":
      if (options.needFullHistory) throw new CustomerAccessError("FORWARD_ONLY");
      return membership;
    case "active_full":
      return membership;
  }
}
