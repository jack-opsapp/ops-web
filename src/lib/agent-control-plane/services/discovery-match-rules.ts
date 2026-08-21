const FORBIDDEN_CONTROL_OR_BIDI_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u;
const UTF8_ENCODER = new TextEncoder();

type DiscoveryTextMatchTier = "exact" | "prefix" | "all_tokens";

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function normalizeSearchableText(value: string): string | null {
  if (
    FORBIDDEN_CONTROL_OR_BIDI_PATTERN.test(value) ||
    hasUnpairedSurrogate(value)
  ) {
    return null;
  }
  try {
    return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  } catch {
    return null;
  }
}

export function returnedBusinessStringIsSafe(
  value: string,
  maximumUtf8Bytes: number
): boolean {
  const normalized = normalizeSearchableText(value);
  return (
    normalized !== null &&
    normalized.length > 0 &&
    value.trim() === value &&
    UTF8_ENCODER.encode(value).length <= maximumUtf8Bytes
  );
}

function compareBytewiseC(left: string, right: string): number {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function scalarLength(value: string): number {
  return Array.from(value).length;
}

function classifyTextMatch(
  value: string,
  canonicalQuery: string
): DiscoveryTextMatchTier | null {
  const normalizedValue = normalizeSearchableText(value);
  const normalizedQuery = normalizeSearchableText(canonicalQuery);
  if (
    normalizedValue === null ||
    normalizedQuery === null ||
    normalizedQuery !== canonicalQuery
  ) {
    return null;
  }
  if (normalizedValue === normalizedQuery) return "exact";
  if (normalizedValue.startsWith(normalizedQuery)) return "prefix";
  const tokens = normalizedQuery.split(" ");
  if (
    tokens.length === 0 ||
    tokens.some((token) => scalarLength(token) < 3) ||
    !tokens.every((token) => normalizedValue.includes(token))
  ) {
    return null;
  }
  return "all_tokens";
}

export function customerNameMatchBasisFits(input: {
  readonly displayName: string;
  readonly canonicalQuery: string;
  readonly claimedBasis: "exact_name" | "prefix_name" | "all_tokens_name";
}): boolean {
  const tier = classifyTextMatch(input.displayName, input.canonicalQuery);
  return tier !== null && input.claimedBasis === `${tier}_name`;
}

export function expectedJobTextMatchBasis(input: {
  readonly displayTitle: string;
  readonly address: string | null;
  readonly canonicalQuery: string;
  readonly queryFields: readonly ("title" | "address")[];
}):
  | "exact_title"
  | "prefix_title"
  | "all_tokens_title"
  | "exact_address"
  | "prefix_address"
  | "all_tokens_address"
  | null {
  const candidates: Array<{
    readonly tier: DiscoveryTextMatchTier;
    readonly field: "title" | "address";
  }> = [];
  if (input.queryFields.includes("title")) {
    const tier = classifyTextMatch(input.displayTitle, input.canonicalQuery);
    if (tier) candidates.push({ tier, field: "title" });
  }
  if (input.queryFields.includes("address") && input.address !== null) {
    const tier = classifyTextMatch(input.address, input.canonicalQuery);
    if (tier) candidates.push({ tier, field: "address" });
  }
  const tierRank = { exact: 1, prefix: 2, all_tokens: 3 } as const;
  const fieldRank = { title: 1, address: 2 } as const;
  candidates.sort(
    (left, right) =>
      tierRank[left.tier] - tierRank[right.tier] ||
      fieldRank[left.field] - fieldRank[right.field]
  );
  const best = candidates[0];
  return best ? `${best.tier}_${best.field}` : null;
}

type CustomerDiscoveryOrderMatch = Readonly<{
  customer_ref: Readonly<{
    kind: "client" | "sub_client";
    id: string;
  }>;
  display_name: string;
  match_basis: Readonly<{
    kind:
      | "exact_name"
      | "prefix_name"
      | "all_tokens_name"
      | "exact_email"
      | "exact_phone";
  }>;
}>;

export function compareCustomerDiscoveryOrder(
  left: CustomerDiscoveryOrderMatch,
  right: CustomerDiscoveryOrderMatch
): number | null {
  const tierRank = {
    exact_name: 1,
    exact_email: 1,
    exact_phone: 1,
    prefix_name: 2,
    all_tokens_name: 3,
  } as const;
  const kindRank = { client: 1, sub_client: 2 } as const;
  const leftName = normalizeSearchableText(left.display_name);
  const rightName = normalizeSearchableText(right.display_name);
  if (leftName === null || rightName === null) return null;
  return (
    compareNumber(
      tierRank[left.match_basis.kind],
      tierRank[right.match_basis.kind]
    ) ||
    compareNumber(
      kindRank[left.customer_ref.kind],
      kindRank[right.customer_ref.kind]
    ) ||
    compareBytewiseC(leftName, rightName) ||
    compareBytewiseC(left.customer_ref.id, right.customer_ref.id)
  );
}

type JobDiscoveryOrderMatch = Readonly<{
  job_ref: Readonly<{
    kind: "opportunity" | "project";
    id: string;
  }>;
  display_title: string;
  address: string | null;
  dates:
    | Readonly<{
        created_at: string;
        updated_at: string;
      }>
    | Readonly<{
        created_at: string;
        updated_at: string;
        start_date: string | null;
        end_date: string | null;
      }>;
  match_basis: Readonly<{
    kind:
      | "filter_only"
      | "exact_title"
      | "prefix_title"
      | "all_tokens_title"
      | "exact_address"
      | "prefix_address"
      | "all_tokens_address";
    field: "none" | "title" | "address";
  }>;
}>;

export function compareJobDiscoveryOrder(input: {
  readonly left: JobDiscoveryOrderMatch;
  readonly right: JobDiscoveryOrderMatch;
  readonly dateField: "created_at" | "updated_at";
}): number | null {
  const left = input.left;
  const right = input.right;
  const kindRank = { opportunity: 1, project: 2 } as const;
  const leftKind = left.match_basis.kind;
  const rightKind = right.match_basis.kind;
  if (leftKind === "filter_only" || rightKind === "filter_only") {
    if (leftKind !== "filter_only" || rightKind !== "filter_only") return null;
    const leftSortAt = Date.parse(left.dates[input.dateField]);
    const rightSortAt = Date.parse(right.dates[input.dateField]);
    if (!Number.isFinite(leftSortAt) || !Number.isFinite(rightSortAt)) {
      return null;
    }
    return (
      compareNumber(rightSortAt, leftSortAt) ||
      compareNumber(
        kindRank[left.job_ref.kind],
        kindRank[right.job_ref.kind]
      ) ||
      compareBytewiseC(left.job_ref.id, right.job_ref.id)
    );
  }

  const tierRank = {
    exact_title: 1,
    exact_address: 1,
    prefix_title: 2,
    prefix_address: 2,
    all_tokens_title: 3,
    all_tokens_address: 3,
  } as const;
  const fieldRank = { title: 1, address: 2 } as const;
  const leftField = left.match_basis.field;
  const rightField = right.match_basis.field;
  if (leftField === "none" || rightField === "none") return null;
  const leftValue = normalizeSearchableText(
    leftField === "title" ? left.display_title : (left.address ?? "")
  );
  const rightValue = normalizeSearchableText(
    rightField === "title" ? right.display_title : (right.address ?? "")
  );
  if (!leftValue || !rightValue) return null;
  return (
    compareNumber(tierRank[leftKind], tierRank[rightKind]) ||
    compareNumber(fieldRank[leftField], fieldRank[rightField]) ||
    compareNumber(kindRank[left.job_ref.kind], kindRank[right.job_ref.kind]) ||
    compareBytewiseC(leftValue, rightValue) ||
    compareBytewiseC(left.job_ref.id, right.job_ref.id)
  );
}
