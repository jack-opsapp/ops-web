"use client";

/**
 * OPS Web — ⌘K result rows.
 *
 * One row per hit from `search_workspace`, five kinds, one anatomy:
 *
 *     [glyph]  Primary identity ─────────── secondary facts · STATUS
 *
 * The operator opened the palette with a fragment in mind and is scanning for
 * one thing. So the left edge is identity (what they typed toward) and the
 * right edge is disambiguation (which of the three "Frame stairs" is this).
 * Status sits last because it is the final tiebreaker, never the reason a row
 * was opened — and its uppercase mono block doubles as a right-edge anchor that
 * keeps eight rows scanning as a column instead of a ragged list.
 *
 * cmdk mechanics that are load-bearing here (verified against cmdk 1.1.1):
 * - Every row AND its group carries `forceMount`. cmdk only keeps a group
 *   visible while `filtered.groups` holds it, and that set is built from
 *   REGISTERED items — which forceMount rows never become (bug fa5a9ff2).
 * - cmdk re-sorts each group's items by fuzzy score on every keystroke.
 *   These rows arrive ranked by the database, and a hit matched on a field the
 *   row does not show (a project note, an invoice subject) scores zero — so
 *   every row value carries `HIT_VALUE_PREFIX` and the palette's filter hands
 *   those a flat score, which leaves the server's order intact.
 */

import type { LucideIcon } from "lucide-react";
import {
  ClipboardList,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  Target,
  Users,
} from "lucide-react";
import { CommandItem } from "@/components/ui/command";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils/cn";
import { formatCurrency, formatEnumLabel } from "@/lib/utils/format";
import { statusTagVariant, type StatusTagKind } from "@/lib/utils/status-tag-variant";
import type {
  WorkspaceClientHit,
  WorkspaceDocumentHit,
  WorkspaceLeadHit,
  WorkspaceProjectHit,
  WorkspaceTaskHit,
} from "@/lib/types/workspace-search";

/**
 * Marks a value as a server-ranked hit rather than a command. U+2063 is an
 * invisible format character: it survives cmdk's `trim()`, renders nothing, and
 * cannot be typed into the input, so no operator query can collide with it.
 */
export const HIT_VALUE_PREFIX = "\u2063hit";

/** The dictionary accessor, narrowed to the `t(key, fallback)` form. */
export type PaletteTranslate = (key: string, fallback?: string) => string;

/** Design rule: an absent value is an em dash, never "N/A" and never blank. */
const EMPTY = "—";

function hitValue(parts: Array<string | null | undefined>): string {
  return [HIT_VALUE_PREFIX, ...parts.filter(Boolean)].join(" ");
}

function statusLabel(t: PaletteTranslate, kind: StatusTagKind, raw: string | null): string | null {
  if (!raw) return null;
  return t(`status.${kind}.${raw}`, formatEnumLabel(raw));
}

interface PaletteRowProps {
  glyph: LucideIcon;
  /** Read aloud before the row's text — the glyph alone does not say "invoice". */
  kindLabel: string;
  value: string;
  onSelect: () => void;
  primary: React.ReactNode;
  /** Second-line facts in reading order; a `·` is drawn between them. */
  meta: React.ReactNode[];
}

function PaletteRow({
  glyph: Glyph,
  kindLabel,
  value,
  onSelect,
  primary,
  meta,
}: PaletteRowProps) {
  return (
    <CommandItem value={value} onSelect={onSelect} forceMount>
      <Glyph className="h-icon-16 w-icon-16 shrink-0 text-text-3" aria-hidden="true" />
      <span className="sr-only">{kindLabel}</span>
      <span className="flex min-w-0 flex-1 items-baseline gap-0.5">{primary}</span>
      <span className="flex min-w-0 shrink items-center gap-0.5 font-mono text-micro text-text-3">
        {meta.map((entry, index) => (
          <span key={index} className="flex min-w-0 items-center gap-0.5">
            {index > 0 && (
              // text-mute is the design system's separator colour — decorative,
              // never a value.
              <span className="text-text-mute" aria-hidden="true">
                ·
              </span>
            )}
            {typeof entry === "string" ? <span className="truncate">{entry}</span> : entry}
          </span>
        ))}
      </span>
    </CommandItem>
  );
}

/** The row's headline: the name the operator was reaching for. */
function Primary({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("truncate font-mohave text-body-sm text-text", className)}>
      {children}
    </span>
  );
}

export function ProjectRow({
  hit,
  t,
  onSelect,
}: {
  hit: WorkspaceProjectHit;
  t: PaletteTranslate;
  onSelect: () => void;
}) {
  const status = statusLabel(t, "project", hit.status);
  return (
    <PaletteRow
      glyph={FolderKanban}
      kindLabel={t("group.projects")}
      // The client name never renders (the address disambiguates better) but a
      // project can come back for a client-name query, so it belongs in the value.
      value={hitValue(["project", hit.title, hit.address, hit.client_name, hit.id])}
      onSelect={onSelect}
      primary={<Primary>{hit.title || EMPTY}</Primary>}
      meta={[
        hit.address || EMPTY,
        status ? (
          <Tag key="status" variant={statusTagVariant("project", hit.status)}>
            {status}
          </Tag>
        ) : null,
      ].filter(Boolean)}
    />
  );
}

export function ClientRow({
  hit,
  t,
  onSelect,
}: {
  hit: WorkspaceClientHit;
  t: PaletteTranslate;
  onSelect: () => void;
}) {
  return (
    <PaletteRow
      glyph={Users}
      kindLabel={t("group.clients")}
      value={hitValue(["client", hit.name, hit.phone, hit.email, hit.address, hit.id])}
      onSelect={onSelect}
      primary={<Primary>{hit.name || EMPTY}</Primary>}
      // A phone number is what an operator dials from a search result; the email
      // only stands in when there is no number.
      meta={[hit.phone || hit.email || EMPTY]}
    />
  );
}

export function LeadRow({
  hit,
  t,
  onSelect,
}: {
  hit: WorkspaceLeadHit;
  t: PaletteTranslate;
  onSelect: () => void;
}) {
  const stage = statusLabel(t, "lead", hit.stage);
  return (
    <PaletteRow
      glyph={Target}
      kindLabel={t("group.leads")}
      value={hitValue(["lead", hit.title, hit.contact_name, hit.address, hit.id])}
      onSelect={onSelect}
      primary={<Primary>{hit.title || EMPTY}</Primary>}
      meta={[
        hit.contact_name || EMPTY,
        stage ? (
          <Tag key="stage" variant={statusTagVariant("lead", hit.stage)}>
            {stage}
          </Tag>
        ) : null,
      ].filter(Boolean)}
    />
  );
}

export function TaskRow({
  hit,
  t,
  onSelect,
}: {
  hit: WorkspaceTaskHit;
  t: PaletteTranslate;
  onSelect: () => void;
}) {
  const status = statusLabel(t, "task", hit.status);
  return (
    <PaletteRow
      glyph={ClipboardList}
      kindLabel={t("group.tasks")}
      value={hitValue(["task", hit.title, hit.project_title, hit.task_type, hit.id])}
      onSelect={onSelect}
      primary={<Primary>{hit.title || EMPTY}</Primary>}
      // Tasks repeat across jobs — the project is the only thing that tells
      // one "Frame stairs" from another.
      meta={[
        hit.project_title || EMPTY,
        status ? (
          <Tag key="status" variant={statusTagVariant("task", hit.status)}>
            {status}
          </Tag>
        ) : null,
      ].filter(Boolean)}
    />
  );
}

export function DocumentRow({
  hit,
  t,
  onSelect,
}: {
  hit: WorkspaceDocumentHit;
  t: PaletteTranslate;
  onSelect: () => void;
}) {
  const status = statusLabel(t, "document", hit.status);
  const kindLabel = hit.kind === "invoice" ? t("row.invoice") : t("row.estimate");
  return (
    <PaletteRow
      glyph={hit.kind === "invoice" ? FileText : FileSpreadsheet}
      kindLabel={kindLabel}
      value={hitValue([
        hit.kind,
        hit.number,
        hit.title,
        hit.client_name,
        // Number without its punctuation. The database is what matches
        // `inv1042` to `INV-1042`; this only keeps the row's cmdk value honest
        // about what it represents.
        hit.number?.replace(/[^a-zA-Z0-9]/g, ""),
        hit.id,
      ])}
      onSelect={onSelect}
      primary={
        <>
          {/* A document number is a number: mono, always. */}
          <span className="shrink-0 font-mono text-body-sm text-text">
            {hit.number || EMPTY}
          </span>
          {hit.title ? <Primary>{hit.title}</Primary> : null}
        </>
      }
      meta={[
        hit.client_name || EMPTY,
        hit.total !== null ? formatCurrency(hit.total) : EMPTY,
        status ? (
          <Tag key="status" variant={statusTagVariant("document", hit.status)}>
            {status}
          </Tag>
        ) : null,
      ].filter(Boolean)}
    />
  );
}
