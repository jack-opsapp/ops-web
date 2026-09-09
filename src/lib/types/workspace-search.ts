/**
 * OPS Web — universal search envelope.
 *
 * `public.search_workspace(p_query, p_limit_per_kind)` returns one jsonb
 * envelope holding the top hits per kind. This module is the client-side
 * contract for that envelope plus a defensive parser: the database is the only
 * writer, but a shape drift must never crash the command palette, so anything
 * unrecognised degrades to an empty group and a malformed item is dropped
 * rather than rendered half-built.
 */

export type WorkspaceSearchKind =
  | "projects"
  | "clients"
  | "leads"
  | "tasks"
  | "documents";

/** Documents unify invoices and estimates; the glyph and route key off this. */
export type WorkspaceDocumentKind = "invoice" | "estimate";

export interface WorkspaceProjectHit {
  id: string;
  title: string | null;
  address: string | null;
  status: string | null;
  client_name: string | null;
  updated_at: string | null;
}

export interface WorkspaceClientHit {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  updated_at: string | null;
}

export interface WorkspaceLeadHit {
  id: string;
  title: string | null;
  contact_name: string | null;
  stage: string | null;
  address: string | null;
  updated_at: string | null;
}

export interface WorkspaceTaskHit {
  id: string;
  title: string | null;
  project_id: string | null;
  project_title: string | null;
  task_type: string | null;
  status: string | null;
  updated_at: string | null;
}

export interface WorkspaceDocumentHit {
  id: string;
  kind: WorkspaceDocumentKind;
  number: string | null;
  title: string | null;
  client_name: string | null;
  total: number | null;
  status: string | null;
  updated_at: string | null;
}

/**
 * `total` is every row of that kind the caller can see, not the length of
 * `items` — `items` is capped at `p_limit_per_kind`, so a group heading can
 * say how much was left behind.
 */
export interface WorkspaceSearchGroup<T> {
  total: number;
  items: T[];
}

export interface WorkspaceSearchResult {
  query: string;
  tokens: string[];
  projects: WorkspaceSearchGroup<WorkspaceProjectHit>;
  clients: WorkspaceSearchGroup<WorkspaceClientHit>;
  leads: WorkspaceSearchGroup<WorkspaceLeadHit>;
  tasks: WorkspaceSearchGroup<WorkspaceTaskHit>;
  documents: WorkspaceSearchGroup<WorkspaceDocumentHit>;
}

function emptyGroup<T>(): WorkspaceSearchGroup<T> {
  return { total: 0, items: [] };
}

/** A fresh envelope every call — callers own their copy. */
export function emptyWorkspaceSearchResult(): WorkspaceSearchResult {
  return {
    query: "",
    tokens: [],
    projects: emptyGroup(),
    clients: emptyGroup(),
    leads: emptyGroup(),
    tasks: emptyGroup(),
    documents: emptyGroup(),
  };
}

/** Reference empty envelope for comparisons and initial render. */
export const EMPTY_WORKSPACE_SEARCH: WorkspaceSearchResult =
  emptyWorkspaceSearchResult();

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Text columns arrive as string or null; anything else is not text. */
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** `id` is the only field a row cannot survive without. */
function id(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Postgres `numeric` crosses PostgREST as a string to preserve precision, so
 * money is coerced here — never trusted as already-numeric.
 */
function money(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGroup<T>(
  value: unknown,
  parseItem: (raw: UnknownRecord) => T | null,
): WorkspaceSearchGroup<T> {
  if (!isRecord(value)) return emptyGroup<T>();
  const rawItems = Array.isArray(value.items) ? value.items : [];
  const items: T[] = [];
  for (const raw of rawItems) {
    if (!isRecord(raw)) continue;
    const item = parseItem(raw);
    if (item !== null) items.push(item);
  }
  const total = Number(value.total);
  return {
    total: Number.isFinite(total) && total >= 0 ? total : items.length,
    items,
  };
}

function parseProject(raw: UnknownRecord): WorkspaceProjectHit | null {
  const rowId = id(raw.id);
  if (!rowId) return null;
  return {
    id: rowId,
    title: text(raw.title),
    address: text(raw.address),
    status: text(raw.status),
    client_name: text(raw.client_name),
    updated_at: text(raw.updated_at),
  };
}

function parseClient(raw: UnknownRecord): WorkspaceClientHit | null {
  const rowId = id(raw.id);
  if (!rowId) return null;
  return {
    id: rowId,
    name: text(raw.name),
    email: text(raw.email),
    phone: text(raw.phone),
    address: text(raw.address),
    updated_at: text(raw.updated_at),
  };
}

function parseLead(raw: UnknownRecord): WorkspaceLeadHit | null {
  const rowId = id(raw.id);
  if (!rowId) return null;
  return {
    id: rowId,
    title: text(raw.title),
    contact_name: text(raw.contact_name),
    stage: text(raw.stage),
    address: text(raw.address),
    updated_at: text(raw.updated_at),
  };
}

function parseTask(raw: UnknownRecord): WorkspaceTaskHit | null {
  const rowId = id(raw.id);
  if (!rowId) return null;
  return {
    id: rowId,
    title: text(raw.title),
    project_id: text(raw.project_id),
    project_title: text(raw.project_title),
    task_type: text(raw.task_type),
    status: text(raw.status),
    updated_at: text(raw.updated_at),
  };
}

function parseDocument(raw: UnknownRecord): WorkspaceDocumentHit | null {
  const rowId = id(raw.id);
  if (!rowId) return null;
  // The kind decides the glyph and the route, so an unknown kind is not a
  // renderable row.
  const kind = raw.kind;
  if (kind !== "invoice" && kind !== "estimate") return null;
  return {
    id: rowId,
    kind,
    number: text(raw.number),
    title: text(raw.title),
    client_name: text(raw.client_name),
    total: money(raw.total),
    status: text(raw.status),
    updated_at: text(raw.updated_at),
  };
}

/**
 * Turns the RPC's `Json` payload into a `WorkspaceSearchResult`. Never throws:
 * an unrecognised payload becomes the empty envelope, a malformed item is
 * dropped, and every absent field lands as `null`.
 */
export function parseWorkspaceSearchResult(json: unknown): WorkspaceSearchResult {
  if (!isRecord(json)) return emptyWorkspaceSearchResult();
  return {
    query: text(json.query) ?? "",
    tokens: Array.isArray(json.tokens)
      ? json.tokens.filter((token): token is string => typeof token === "string")
      : [],
    projects: parseGroup(json.projects, parseProject),
    clients: parseGroup(json.clients, parseClient),
    leads: parseGroup(json.leads, parseLead),
    tasks: parseGroup(json.tasks, parseTask),
    documents: parseGroup(json.documents, parseDocument),
  };
}
