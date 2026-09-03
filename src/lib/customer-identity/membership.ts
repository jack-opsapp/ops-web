import "server-only";

import type { CustomerIdentityDeps } from "./config";
import { CustomerAccessError, CustomerIdentityInputError } from "./errors";
import {
  linkMembershipRow,
  readMembershipRow,
  resolveOrCreateMembershipRow,
  type MembershipOutcome,
  type MembershipState,
  type ResolveMembershipRow,
} from "./rpc";
import type { CustomerSession } from "./session";

/**
 * Company-scoped membership (design §5.3, I2, I3, I17, I18). Resolution runs
 * inside the database under the company/email advisory lock; this module
 * projects the result to a route-safe shape. The company-owned client ids stay
 * behind the boundary: nothing here returns them, so a route cannot leak what
 * it never received.
 *
 * Reporting a membership and establishing one are different operations and
 * have different functions. A read may never cause a row to appear in a
 * company's data (I17), and signing in establishes a membership only against a
 * client already on file (I18) — the 2026-09-03 live run proved what a single
 * resolve-or-create RPC on a read path does to a live tenant.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface CustomerMembership {
  readonly membershipId: string;
  readonly state: MembershipState;
  readonly outcome: MembershipOutcome;
}

type MembershipReader = (
  client: CustomerIdentityDeps["rpc"],
  input: { identityId: string; companyId: string }
) => Promise<ResolveMembershipRow | null>;

async function project(
  read: MembershipReader,
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
  const row = await read(deps.rpc, { identityId, companyId });
  if (row === null) return null;
  return Object.freeze({
    membershipId: row.membership_id,
    state: row.state,
    outcome: row.outcome,
  });
}

/**
 * What this identity's membership with this company *is*. The only resolver a
 * read path may use: `GET /api/customer/me`, the authority gate below, and
 * every hosted render. It creates nothing and promotes nothing.
 */
export async function readMembership(
  deps: CustomerIdentityDeps,
  identityId: string,
  companyId: string
): Promise<CustomerMembership | null> {
  return project(readMembershipRow, deps, identityId, companyId);
}

/**
 * Sign-in (§5.1 step 3, I18). A verified email that matches exactly one client
 * on file establishes a membership under the I2 evidence rules; anything else
 * — no match, or an ambiguous one — establishes nothing and answers null. No
 * client record is ever created by signing in.
 */
export async function linkMembership(
  deps: CustomerIdentityDeps,
  identityId: string,
  companyId: string
): Promise<CustomerMembership | null> {
  return project(linkMembershipRow, deps, identityId, companyId);
}

/**
 * The create-capable resolver, for genuine customer intent only: the P2 guest
 * booking confirm, the P2 booking claim, and the P4 lead intake. It creates
 * the client when nothing matched, which is right when the customer asked this
 * business for something and wrong everywhere else.
 */
export async function resolveOrCreateMembership(
  deps: CustomerIdentityDeps,
  identityId: string,
  companyId: string
): Promise<CustomerMembership | null> {
  return project(resolveOrCreateMembershipRow, deps, identityId, companyId);
}

/**
 * Authority gate for a request. Re-reads on every call — nothing is cached
 * from the session, and asking for access never grants it — and denies with a
 * code that names no record: NOT_FOUND (no live membership), REVOKED (the
 * company withdrew access), FORWARD_ONLY (history requested before company
 * evidence exists).
 */
export async function requireMembership(
  deps: CustomerIdentityDeps,
  session: CustomerSession,
  companyId: string,
  options: { readonly needFullHistory: boolean }
): Promise<CustomerMembership> {
  const membership = await readMembership(deps, session.identityId, companyId);
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
