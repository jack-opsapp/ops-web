import "server-only";

import {
  P2ComponentSelectionVectorSchema,
  type P2ComponentSelection,
  type P2Warning,
} from "@/lib/agent-control-plane/contracts";

const COMPONENT_AUTHORIZATION_DENIALS = new WeakSet<object>();

/** A nominal, permission-only denial that a default may safely omit. */
export class P2ComponentAuthorizationDeniedError extends Error {
  readonly code = "P2_COMPONENT_AUTHORIZATION_DENIED" as const;

  constructor() {
    super("P2_COMPONENT_AUTHORIZATION_DENIED");
    this.name = "P2ComponentAuthorizationDeniedError";
    COMPONENT_AUTHORIZATION_DENIALS.add(this);
    Object.freeze(this);
  }
}

function isComponentAuthorizationDenied(
  value: unknown
): value is P2ComponentAuthorizationDeniedError {
  return (
    typeof value === "object" &&
    value !== null &&
    COMPONENT_AUTHORIZATION_DENIALS.has(value)
  );
}

export class P2CompositeAuthorizationError extends Error {
  readonly code:
    | "P2_COMPOSITE_SELECTION_INVALID"
    | "P2_EXPLICIT_COMPONENT_UNAUTHORIZED";

  constructor(code: P2CompositeAuthorizationError["code"]) {
    super(code);
    this.name = "P2CompositeAuthorizationError";
    this.code = code;
  }
}

export interface P2CompositeReadResult<TValue> {
  readonly components: readonly Readonly<{
    component: string;
    value: TValue;
  }>[];
  readonly warnings: readonly P2Warning[];
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

/**
 * Completes the authorization plan before invoking any component read. An
 * explicit denial therefore cannot leak the existence or timing of a source
 * already read by an earlier component.
 */
export async function executeP2CompositeRead<TAuthorization, TValue>(input: {
  readonly selections: readonly P2ComponentSelection[];
  readonly authorize: (
    selection: P2ComponentSelection
  ) => TAuthorization | Promise<TAuthorization>;
  readonly read: (
    component: string,
    authorization: TAuthorization
  ) => TValue | Promise<TValue>;
}): Promise<P2CompositeReadResult<TValue>> {
  const parsed = P2ComponentSelectionVectorSchema.safeParse(input.selections);
  if (!parsed.success) {
    throw new P2CompositeAuthorizationError("P2_COMPOSITE_SELECTION_INVALID");
  }

  const authorized: Array<{
    selection: P2ComponentSelection;
    authorization: TAuthorization;
  }> = [];
  const warnings: P2Warning[] = [];
  for (const selection of parsed.data) {
    try {
      authorized.push({
        selection,
        authorization: await input.authorize(selection),
      });
    } catch (error) {
      if (!isComponentAuthorizationDenied(error)) throw error;
      if (selection.origin === "explicit") {
        throw new P2CompositeAuthorizationError(
          "P2_EXPLICIT_COMPONENT_UNAUTHORIZED"
        );
      }
      warnings.push({
        code: "DEFAULT_COMPONENT_OMITTED",
        component: selection.component,
      });
    }
  }

  const components: Array<{ component: string; value: TValue }> = [];
  for (const entry of authorized) {
    components.push({
      component: entry.selection.component,
      value: await input.read(entry.selection.component, entry.authorization),
    });
  }
  return deepFreeze({ components, warnings });
}
