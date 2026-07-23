"use client";

/**
 * Company-level AI feature toggles used inside the System → Feature Flags tab.
 *
 * Post-2026-04-24 flag collapse (migration 20260424000000):
 *   ai_email_review has been merged into phase_c. Only phase_c is writable
 *   from this panel. Any latent ai_email_review rows returned by the API
 *   are ignored — they'll be dropped in migration 20260424000002 (N2).
 *
 * Flipping `phase_c` ON fires the wizard-ready notification to every admin
 * of the target company (via AdminFeatureOverrideService.setOverride).
 *
 * Reads and writes via the existing `/api/admin/ai-features` routes.
 */

import {
  useState,
  useMemo,
  useEffect,
  useCallback,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";

interface CompanyFeatureRow {
  id: string;
  name: string;
  phaseC: { enabled: boolean; enabledAt: string | null };
  inboxUi: { enabled: boolean; enabledAt: string | null };
}

type FilterKey = "ALL" | "PHASE_C" | "INBOX_UI" | "NONE";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL", label: "ALL" },
  { key: "PHASE_C", label: "PHASE C ON" },
  { key: "INBOX_UI", label: "INBOX UI ON" },
  { key: "NONE", label: "OFF" },
];

function formatEnabledAt(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

interface ApiCompanyRow {
  id: string;
  name: string;
  phaseC: { enabled: boolean; enabledAt: string | null };
  inboxUi: { enabled: boolean; enabledAt: string | null };
}

export function CompanyAiFeatures() {
  const [companies, setCompanies] = useState<CompanyFeatureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  // Initial load
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/admin/ai-features", {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ApiCompanyRow[];
        if (!cancelled) {
          setCompanies(
            data.map((c) => ({
              id: c.id,
              name: c.name,
              phaseC: c.phaseC,
              inboxUi: c.inboxUi ?? { enabled: false, enabledAt: null },
            }))
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    return companies.filter((c) => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (filter === "PHASE_C") return c.phaseC.enabled;
      if (filter === "INBOX_UI") return c.inboxUi.enabled;
      if (filter === "NONE") return !c.phaseC.enabled && !c.inboxUi.enabled;
      return true;
    });
  }, [companies, search, filter]);

  const toggle = useCallback(
    async (companyId: string, nextEnabled: boolean) => {
      // Turning phase_c ON fires wizard notifications and unblocks crons
      // that generate real agent proposals against real client data. Pause
      // for an explicit confirmation.
      if (nextEnabled) {
        const company = companies.find((c) => c.id === companyId);
        const ok = window.confirm(
          `Enable Phase C for "${company?.name}"?\n\n` +
            `This unlocks the approval queue, comms wizard, and every cron job ` +
            `that checks the phase_c flag (project health, status updates, ` +
            `payment reminders, scheduling optimization). The wizard-ready ` +
            `notification will fire to all company admins.`
        );
        if (!ok) return;
      }

      setPendingIds((s) => new Set([...s, `${companyId}:phase_c`]));
      setError(null);

      try {
        const res = await fetch(`/api/admin/ai-features/${companyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ phase_c: nextEnabled }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        // Optimistic local update — matches the server state the PATCH just
        // produced.
        setCompanies((prev) =>
          prev.map((c) =>
            c.id === companyId
              ? {
                  ...c,
                  phaseC: {
                    enabled: nextEnabled,
                    enabledAt: nextEnabled ? new Date().toISOString() : null,
                  },
                }
              : c
          )
        );

        startTransition(() => router.refresh());
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(`Failed to toggle phase_c: ${message}`);
      } finally {
        setPendingIds((s) => {
          const next = new Set(s);
          next.delete(`${companyId}:phase_c`);
          return next;
        });
      }
    },
    [companies, router]
  );

  const toggleInboxUi = useCallback(
    async (companyId: string, nextEnabled: boolean) => {
      setPendingIds((s) => new Set([...s, `${companyId}:inbox_ui`]));
      setError(null);

      try {
        const res = await fetch(`/api/admin/ai-features/${companyId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ inbox_ui: nextEnabled }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        setCompanies((prev) =>
          prev.map((c) =>
            c.id === companyId
              ? {
                  ...c,
                  inboxUi: {
                    enabled: nextEnabled,
                    enabledAt: nextEnabled ? new Date().toISOString() : null,
                  },
                }
              : c
          )
        );

        startTransition(() => router.refresh());
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(`Failed to toggle inbox_ui: ${message}`);
      } finally {
        setPendingIds((s) => {
          const next = new Set(s);
          next.delete(`${companyId}:inbox_ui`);
          return next;
        });
      }
    },
    [router]
  );

  const phaseCCount = companies.filter((c) => c.phaseC.enabled).length;
  const inboxUiCount = companies.filter((c) => c.inboxUi.enabled).length;

  if (loading) {
    return (
      <div className="border border-white/[0.08] rounded-lg p-6">
        <p className="font-mohave text-[12px] uppercase text-[#6B6B6B]">
          Loading company AI features...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mohave text-[16px] uppercase tracking-wider text-[#EDEDED]">
            Company AI Features
          </h2>
          <p className="font-mono text-[12px] text-[#6B6B6B] mt-1">
            [{companies.length} companies · phase_c: {phaseCCount} on · inbox_ui: {inboxUiCount} on]
          </p>
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-xs">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="[search companies]"
            className="w-full h-10 bg-transparent border border-white/[0.08] rounded-lg px-4 font-mono text-[14px] text-[#EDEDED] placeholder-[#6B6B6B] focus:outline-none focus:border-[#6F94B0] transition-colors"
          />
        </div>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={[
                "px-3 py-1.5 rounded-full font-mohave text-[12px] uppercase border transition-colors",
                filter === f.key
                  ? "text-[#EDEDED] border-white/[0.12] bg-white/[0.05]"
                  : "text-[#6B6B6B] border-white/[0.05] hover:text-[#A0A0A0]",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="border border-[#93321A]/40 bg-[#93321A]/10 rounded-lg px-4 py-3 font-mono text-[12px] text-[#EDEDED]">
          [error] {error}
        </div>
      )}

      {/* Table */}
      <div className="border border-white/[0.08] rounded-lg overflow-hidden">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] px-6 py-3 border-b border-white/[0.08]">
          <span className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">
            Company
          </span>
          <span className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">
            Phase C
          </span>
          <span className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">
            Since
          </span>
          <span className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">
            Inbox UI
          </span>
          <span className="font-mohave text-[11px] uppercase tracking-widest text-[#6B6B6B]">
            Since
          </span>
        </div>

        {filtered.map((c) => {
          const phaseCKey = `${c.id}:phase_c`;
          const phaseCPending = pendingIds.has(phaseCKey);
          const inboxUiKey = `${c.id}:inbox_ui`;
          const inboxUiPending = pendingIds.has(inboxUiKey);

          return (
            <div
              key={c.id}
              className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] px-6 items-center h-14 border-b border-white/[0.05] last:border-0 hover:bg-white/[0.02] transition-colors"
            >
              <span className="font-mohave text-[14px] text-[#EDEDED] truncate pr-4">
                {c.name}
              </span>

              <Toggle
                enabled={c.phaseC.enabled}
                disabled={phaseCPending}
                onClick={() => toggle(c.id, !c.phaseC.enabled)}
                label="phase_c"
              />
              <span className="font-mono text-[12px] text-[#6B6B6B]">
                [{formatEnabledAt(c.phaseC.enabledAt)}]
              </span>

              <Toggle
                enabled={c.inboxUi.enabled}
                disabled={inboxUiPending}
                onClick={() => toggleInboxUi(c.id, !c.inboxUi.enabled)}
                label="inbox_ui"
              />
              <span className="font-mono text-[12px] text-[#6B6B6B]">
                [{formatEnabledAt(c.inboxUi.enabledAt)}]
              </span>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="font-mohave text-[14px] uppercase text-[#6B6B6B]">
              No results
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Toggle ──────────────────────────────────────────────────────────────────

interface ToggleProps {
  enabled: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}

/**
 * The standardized app toggle. Locks while the PATCH is in-flight so a jittery
 * admin can't double-click.
 */
function Toggle({ enabled, disabled, onClick, label }: ToggleProps) {
  return (
    <Switch
      checked={enabled}
      disabled={disabled}
      onCheckedChange={onClick}
      aria-label={`Toggle ${label}`}
      className="shrink-0"
    />
  );
}
