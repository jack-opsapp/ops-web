/**
 * OPS Web — Deck Design Service (read-only)
 *
 * Reads `deck_designs` rows attached to a LEAD via `opportunity_id`
 * (migration `add_deck_designs_opportunity_id`, 2026-07-14 — bible 03
 * § deck_designs, Lead attachment). The web surface is view-only: decks are
 * drawn and edited on iOS; the pipeline detail renders a card + viewer.
 *
 * Two projections, two jobs:
 *   - SCAN (`fetchForOpportunity`, `fetchForProject`): the columns a row and
 *     its 40px glyph need, plus the `drawing_data` vertices/edges JSON paths.
 *     Never the whole blob, which carries entire framing/material payloads.
 *   - VIEWER (`fetchDesignWithDrawing`): the whole `drawing_data`, because the
 *     fullscreen viewer draws live geometry — and a multi-level design keeps
 *     its geometry under `levels[]` with EMPTY root `vertices`/`edges`, so the
 *     scan projection reads a real deck as an empty drawing (bug b130d23f).
 *
 * Legacy tolerance (bible): `drawing_data` keys may be missing or oddly
 * typed on old rows. A malformed row maps to empty vertices/edges — the card
 * degrades to thumbnail or icon — and never throws out of the mapper.
 */

import { requireSupabase, parseDate, parseDateRequired } from "@/lib/supabase/helpers";
import type {
  DeckWireEdgeInput,
  DeckWireVertexInput,
} from "@/lib/utils/deck-wireframe";

export interface OpportunityDeckDesign {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  version: number;
  projectId: string | null;
  createdAt: Date;
  updatedAt: Date | null;
  /** Raw drawing geometry for the wireframe fallback; [] on legacy/malformed rows. */
  vertices: DeckWireVertexInput[];
  edges: DeckWireEdgeInput[];
}

/**
 * One deck design with its complete `drawing_data` — the fullscreen viewer's
 * input. `drawingData` stays `unknown` here: shaping it is the parser's job
 * (`@/lib/deck/drawing-data`), and the service never assumes a schema version.
 */
export interface DeckDesignWithDrawing
  extends Omit<OpportunityDeckDesign, "vertices" | "edges"> {
  drawingData: unknown;
}

/**
 * The scan-level projection: just enough to answer "has this lead got a deck?"
 * for every lead on the board at once. Deliberately excludes `drawing_data`
 * and `thumbnail_url` — the board renders a glyph, not a drawing.
 */
export interface LeadDeckMarker {
  id: string;
  opportunityId: string;
  title: string;
  version: number;
  updatedAt: Date | null;
}

export interface DeckMarkerSummary {
  count: number;
  latestTitle: string | null;
  latestVersion: number | null;
}

function asInputArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Columns every projection shares — identity, stamp, and provenance. */
const SCAN_COLUMNS =
  "id, title, thumbnail_url, version, project_id, created_at, updated_at";

/** Scan projection: the shared columns plus the two glyph geometry paths. */
const SCAN_SELECT = `${SCAN_COLUMNS}, vertices:drawing_data->vertices, edges:drawing_data->edges`;

/** Viewer projection: the shared columns plus the complete drawing. */
const DRAWING_SELECT = `${SCAN_COLUMNS}, drawing_data`;

function mapDeckRowIdentity(
  row: Record<string, unknown>
): Omit<OpportunityDeckDesign, "vertices" | "edges"> {
  return {
    id: row.id as string,
    title: (row.title as string) ?? "",
    thumbnailUrl: (row.thumbnail_url as string) ?? null,
    version: Number(row.version ?? 1),
    projectId: (row.project_id as string) ?? null,
    createdAt: parseDateRequired(row.created_at),
    updatedAt: parseDate(row.updated_at),
  };
}

function mapDeckDesignFromDb(row: Record<string, unknown>): OpportunityDeckDesign {
  return {
    ...mapDeckRowIdentity(row),
    vertices: asInputArray<DeckWireVertexInput>(row.vertices),
    edges: asInputArray<DeckWireEdgeInput>(row.edges),
  };
}

export const DeckDesignService = {
  /**
   * Fetch every non-deleted deck design attached to an opportunity, newest
   * first. RLS (`company_isolation`) scopes the read to the caller's company.
   */
  async fetchForOpportunity(
    opportunityId: string
  ): Promise<OpportunityDeckDesign[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("deck_designs")
      .select(SCAN_SELECT)
      .eq("opportunity_id", opportunityId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false, nullsFirst: false });

    if (error) {
      throw new Error(
        `Failed to fetch deck designs for opportunity ${opportunityId}: ${error.message}`
      );
    }

    return (data ?? []).map((row) =>
      mapDeckDesignFromDb(row as Record<string, unknown>)
    );
  },

  /**
   * Every non-deleted deck design attached to a PROJECT, newest first — the
   * project workspace's `// DECK DESIGN` section (report acc0d021). A deck
   * carries `project_id` from the moment the lead converts, so the drawing
   * the crew made on the site visit follows the job into the build.
   */
  async fetchForProject(projectId: string): Promise<OpportunityDeckDesign[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("deck_designs")
      .select(SCAN_SELECT)
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false, nullsFirst: false });

    if (error) {
      throw new Error(
        `Failed to fetch deck designs for project ${projectId}: ${error.message}`
      );
    }

    return (data ?? []).map((row) =>
      mapDeckDesignFromDb(row as Record<string, unknown>)
    );
  },

  /**
   * One design with its complete drawing — the fullscreen viewer's read.
   * Returns `null` when the row is gone or soft-deleted, so a stale link
   * degrades to the viewer's empty state instead of throwing at the user.
   */
  async fetchDesignWithDrawing(
    designId: string
  ): Promise<DeckDesignWithDrawing | null> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("deck_designs")
      .select(DRAWING_SELECT)
      .eq("id", designId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to fetch deck design ${designId}: ${error.message}`
      );
    }
    if (!data) return null;

    const row = data as Record<string, unknown>;
    return { ...mapDeckRowIdentity(row), drawingData: row.drawing_data };
  },

  /**
   * Every lead-attached deck in the company, newest first — the board's
   * scan-level source. One cheap company-wide read beats one query per card:
   * RLS (`company_isolation` + `assigned_lead_scope_*`) returns exactly the
   * rows the caller may see, so there is never client-side filtering to do.
   */
  async fetchLeadDeckMarkers(): Promise<LeadDeckMarker[]> {
    const supabase = requireSupabase();

    const { data, error } = await supabase
      .from("deck_designs")
      .select("id, opportunity_id, title, version, updated_at")
      .not("opportunity_id", "is", null)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false, nullsFirst: false });

    if (error) {
      throw new Error(`Failed to fetch lead deck markers: ${error.message}`);
    }

    return (data ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: record.id as string,
        opportunityId: record.opportunity_id as string,
        title: (record.title as string) ?? "",
        version: Number(record.version ?? 1),
        updatedAt: parseDate(record.updated_at),
      };
    });
  },
};

/**
 * Collapse markers to one summary per lead. The query already ordered by
 * `updated_at` desc, so the FIRST marker seen for a lead is its latest — no
 * re-sorting, and the summary stays stable for a given response.
 */
export function buildDeckMarkerMap(
  markers: LeadDeckMarker[]
): Map<string, DeckMarkerSummary> {
  const summaries = new Map<string, DeckMarkerSummary>();
  for (const marker of markers) {
    const existing = summaries.get(marker.opportunityId);
    if (existing) {
      existing.count += 1;
      continue;
    }
    summaries.set(marker.opportunityId, {
      count: 1,
      latestTitle: marker.title || null,
      latestVersion: marker.version,
    });
  }
  return summaries;
}
