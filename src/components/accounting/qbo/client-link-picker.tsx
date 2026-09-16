"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { useDictionary } from "@/i18n/client";
import { cn } from "@/lib/utils/cn";
import { EntityPicker } from "@/components/ui/entity-picker";
import type { QboMatchCandidate } from "@/lib/types/qbo-import";

/** An OPS client a QuickBooks customer can be linked to. */
export interface LinkableClient {
  id: string;
  name: string;
  email: string | null;
  phoneNumber: string | null;
}

/**
 * The match-quality qualifier for a candidate option. Exact matches carry no
 * similarity score (it arrives null and coerces to 0), so a percentage is
 * meaningless for them — show the basis instead ("email match" / "exact match").
 * Only a real fuzzy score (0 < score ≤ 1) renders a percentage. Returns null
 * when there is nothing honest to show (never a misleading "0%").
 */
export function candidateQualifier(
  c: QboMatchCandidate,
  t: (key: string) => string
): string | null {
  if (c.basis === "email") return t("qbo.candidate.qualifier.email");
  if (c.basis === "name_exact") return t("qbo.candidate.qualifier.exact");
  if (c.basis === "name_fuzzy" && c.score > 0) return `${Math.round(c.score * 100)}%`;
  return null;
}

/** Clients can be saved with a blank name; never render an empty row or trigger. */
function clientLabel(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed : "—";
}

/**
 * The OPS-client picker on a Link row. Searches EVERY client in the company
 * (name, email, phone) — the importer's own suggestions lead the list with
 * their match qualifier — so an operator can link a QuickBooks customer the
 * matcher missed (a business name vs the owner's name, a renamed client).
 *
 * The review can hold hundreds of rows against hundreds of clients, so the
 * ordered option list is only built while this row's picker is open.
 */
export function ClientLinkPicker({
  customerQbId,
  value,
  candidates,
  clients,
  clientsLoading,
  onChange,
}: {
  customerQbId: string;
  value: string | undefined;
  candidates: QboMatchCandidate[];
  clients: LinkableClient[];
  clientsLoading: boolean;
  onChange: (clientId: string | undefined) => void;
}) {
  const { t } = useDictionary("accounting");
  const { t: tp } = useDictionary("picker");
  const [open, setOpen] = React.useState(false);

  const candidateById = React.useMemo(
    () => new Map(candidates.map((c) => [c.clientId, c])),
    [candidates]
  );

  const items = React.useMemo<LinkableClient[]>(() => {
    if (!open) return [];
    const byId = new Map(clients.map((c) => [c.id, c]));
    // Suggestions first, in the importer's order. A suggestion is always a
    // company client; fall back to its own name if the list hasn't loaded it.
    const suggested = candidates.map(
      (c) =>
        byId.get(c.clientId) ?? {
          id: c.clientId,
          name: c.name ?? c.clientId,
          email: null,
          phoneNumber: null,
        }
    );
    // Everyone else A–Z; a client saved without a name sorts last, not first.
    const rest = clients
      .filter((c) => !candidateById.has(c.id))
      .sort((a, b) => {
        const an = a.name.trim();
        const bn = b.name.trim();
        if (!an !== !bn) return an ? -1 : 1;
        return an.localeCompare(bn);
      });
    return [...suggested, ...rest];
  }, [open, clients, candidates, candidateById]);

  const selectedClient = value ? clients.find((c) => c.id === value) : undefined;
  const selectedName = value
    ? selectedClient
      ? clientLabel(selectedClient.name)
      : candidateById.has(value)
        ? clientLabel(candidateById.get(value)?.name)
        : null
    : null;

  return (
    <EntityPicker<LinkableClient>
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button
          type="button"
          data-testid={`match-candidate-${customerQbId}`}
          className={cn(
            "flex h-7 w-full min-w-0 items-center justify-between gap-1",
            "rounded border border-border-input bg-surface-input px-1.5 py-1.5",
            "font-mono text-caption text-left",
            "transition-all duration-150",
            "focus:border-glass-border-strong focus:outline-none",
            "data-[state=open]:border-glass-border-strong",
            selectedName ? "text-text" : "text-text-3"
          )}
        >
          <span className="truncate">{selectedName ?? t("qbo.candidate.none")}</span>
          <ChevronDown
            className="h-[16px] w-[16px] shrink-0 text-text-3"
            strokeWidth={1.5}
            aria-hidden
          />
        </button>
      }
      label={t("qbo.candidate.label")}
      items={items}
      value={value ?? null}
      onChange={(id) => onChange(id ?? undefined)}
      getId={(c) => c.id}
      getLabel={(c) => clientLabel(c.name)}
      getDescription={(c) => c.email ?? undefined}
      getKeywords={(c) => [c.email, c.phoneNumber].filter((v): v is string => !!v)}
      getSubLabel={(c) => {
        const candidate = candidateById.get(c.id);
        return candidate ? candidateQualifier(candidate, t) ?? undefined : undefined;
      }}
      searchPlaceholder={t("qbo.candidate.search")}
      searchTestId={`match-candidate-search-${customerQbId}`}
      clearLabel={tp("clear")}
      emptyLabel={clientsLoading ? t("qbo.candidate.loading") : t("qbo.candidate.noResults")}
      noneOption
      noneLabel={t("qbo.candidate.none")}
      size="lg"
    />
  );
}
