"use client";

/**
 * OPS Web — Connected Agents section
 *
 * The settings half of the MCP OAuth handshake. The consent panel ends with
 * "[revoke anytime in settings → integrations]"; this is where that promise
 * is kept — one card listing the external agents holding a live grant in this
 * operator's name, each with a way to cut it.
 *
 * Scoped to the caller, not the company: the grants API reads the user from
 * the verified session, so this card only ever shows connections the person
 * reading it authorized themselves.
 *
 * Presentation decisions:
 *   - Neutral row surface, not olive. The Gmail row is olive because a live
 *     mailbox connection is a healthy end-state the operator wants; a list of
 *     outside agents holding read access is an access register, and a fact is
 *     not a success. Earth tones stay semantic (DESIGN.md §3).
 *   - No row icon. Every row in this card is the same kind of thing, so a
 *     glyph on each would repeat the section header and carry nothing
 *     (DESIGN.md §11 — delete an icon that costs no information).
 *   - Scopes collapse to one quiet line rather than the consent panel's
 *     itemized list. On the consent screen the operator is deciding and needs
 *     every line; here they are scanning an inventory they already approved.
 *   - REVOKE is quiet at rest and rose on hover — the exact treatment the
 *     sibling Gmail disconnect uses. A permanent rose block on every row
 *     would point the eye at the destroy action instead of at who has access.
 */

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { connectedAgentScopeLine } from "@/components/settings/connected-agent-scope-labels";
import { useAuthStore } from "@/lib/store/auth-store";
import { authedFetch } from "@/lib/utils/authed-fetch";
import { useDictionary } from "@/i18n/client";

const GRANTS_ENDPOINT = "/api/mcp/oauth/grants";
const ROUTINES_ENDPOINT = "/api/mcp/routines/day-closeout";
const GRANTS_QUERY_KEY = ["mcpOAuthGrants"] as const;
const ROUTINES_QUERY_KEY = ["mcpDayCloseoutRoutines"] as const;

type Translate = (key: string, fallback?: string) => string;

interface GrantRow {
  readonly grantId: string;
  readonly clientName: string;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

interface RoutineRow {
  readonly grantId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly enabled: boolean;
  readonly localTime: string;
  readonly timezone: string;
  readonly nextRunAt: string | null;
  readonly lastRunAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastFailureCode: string | null;
  readonly scheduleRevision: number;
}

function parseGrants(value: unknown): readonly GrantRow[] {
  if (typeof value !== "object" || value === null) return [];
  const grants = (value as Record<string, unknown>).grants;
  if (!Array.isArray(grants)) return [];
  const rows: GrantRow[] = [];
  for (const entry of grants) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.grantId !== "string" || row.grantId === "") continue;
    if (typeof row.clientName !== "string" || row.clientName === "") continue;
    if (typeof row.createdAt !== "string" || row.createdAt === "") continue;
    const scopes = Array.isArray(row.scopes)
      ? row.scopes.filter((s): s is string => typeof s === "string")
      : [];
    rows.push({
      grantId: row.grantId,
      clientName: row.clientName,
      scopes,
      createdAt: row.createdAt,
      lastUsedAt:
        typeof row.lastUsedAt === "string" && row.lastUsedAt !== ""
          ? row.lastUsedAt
          : null,
    });
  }
  return rows;
}

function parseRoutines(value: unknown): readonly RoutineRow[] {
  if (typeof value !== "object" || value === null) return [];
  const routines = (value as Record<string, unknown>).routines;
  if (!Array.isArray(routines)) return [];
  const rows: RoutineRow[] = [];
  for (const entry of routines) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (
      typeof row.grantId !== "string" ||
      typeof row.clientId !== "string" ||
      typeof row.clientName !== "string" ||
      typeof row.enabled !== "boolean" ||
      typeof row.localTime !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.localTime) ||
      typeof row.timezone !== "string" ||
      !Number.isSafeInteger(row.scheduleRevision) ||
      Number(row.scheduleRevision) < 0
    ) {
      continue;
    }
    rows.push({
      grantId: row.grantId,
      clientId: row.clientId,
      clientName: row.clientName,
      enabled: row.enabled,
      localTime: row.localTime,
      timezone: row.timezone,
      nextRunAt: typeof row.nextRunAt === "string" ? row.nextRunAt : null,
      lastRunAt: typeof row.lastRunAt === "string" ? row.lastRunAt : null,
      lastSuccessAt:
        typeof row.lastSuccessAt === "string" ? row.lastSuccessAt : null,
      lastFailureCode:
        typeof row.lastFailureCode === "string" ? row.lastFailureCode : null,
      scheduleRevision: Number(row.scheduleRevision),
    });
  }
  return rows;
}

/**
 * Same relative ladder as the Gmail rows above ("Just now" / "12 min ago" /
 * "3h ago" / "5d ago") so both cards read as one page. DESIGN.md §2: the
 * absent value is an em dash, never a placeholder word.
 */
function formatTimeAgo(iso: string | null, t: Translate): string {
  if (!iso) return "—";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "—";
  const seconds = Math.floor((Date.now() - parsed) / 1000);
  if (seconds < 60) return t("connectedAgents.time.justNow", "Just now");
  if (seconds < 3600)
    return t("connectedAgents.time.minutes", "{{n}} min ago").replace(
      "{{n}}",
      String(Math.floor(seconds / 60))
    );
  if (seconds < 86400)
    return t("connectedAgents.time.hours", "{{n}}h ago").replace(
      "{{n}}",
      String(Math.floor(seconds / 3600))
    );
  return t("connectedAgents.time.days", "{{n}}d ago").replace(
    "{{n}}",
    String(Math.floor(seconds / 86400))
  );
}

function DayCloseoutRoutineControl({ routine }: { routine: RoutineRow }) {
  const { t } = useDictionary("settings");
  const queryClient = useQueryClient();
  const switchId = useId();
  const timeId = useId();
  const [enabled, setEnabled] = useState(routine.enabled);
  const [localTime, setLocalTime] = useState(routine.localTime);

  useEffect(() => {
    setEnabled(routine.enabled);
    setLocalTime(routine.localTime);
  }, [routine.enabled, routine.localTime, routine.scheduleRevision]);

  const save = useMutation({
    mutationFn: async () => {
      const response = await authedFetch(ROUTINES_ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grantId: routine.grantId,
          enabled,
          localTime,
        }),
      });
      if (!response.ok) throw new Error("routine_save_failed");
      return response.json();
    },
    onSuccess: async () => {
      toast.success(t("connectedAgents.closeout.saved", "Day closeout saved"));
      await queryClient.invalidateQueries({ queryKey: ROUTINES_QUERY_KEY });
    },
    onError: () => {
      toast.error(
        t(
          "connectedAgents.closeout.saveFailed",
          "// ERROR — CLOSEOUT NOT SAVED"
        )
      );
    },
  });

  const dirty = enabled !== routine.enabled || localTime !== routine.localTime;
  const lastReview = formatTimeAgo(routine.lastRunAt, t);

  return (
    <div className="mt-1.5 border-t border-border-subtle pt-1.5">
      <div className="flex flex-col gap-1.5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1">
          <span className="block font-mohave text-body text-text">
            {t("connectedAgents.closeout.title", "Close out my day")}
          </span>
          <span className="block font-mohave text-body-sm leading-snug text-text-3">
            {t(
              "connectedAgents.closeout.description",
              "Reviews what you might have missed and puts any filing in OPS for approval."
            )}
          </span>
          <span className="mt-0.5 block font-mono text-micro text-text-mute">
            {t(
              "connectedAgents.closeout.truthBoundary",
              "Sends nothing. Moves no money."
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-1.5">
          <div className="flex h-9 items-center gap-1.5 rounded border border-border px-1.5">
            <Switch
              id={switchId}
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label={t(
                "connectedAgents.closeout.runDaily",
                "Run every day"
              )}
              disabled={save.isPending}
            />
            <label
              htmlFor={switchId}
              className="font-mohave text-body-sm text-text-2"
            >
              {t("connectedAgents.closeout.runDaily", "Run every day")}
            </label>
          </div>
          <div className="w-36">
            <Input
              id={timeId}
              type="time"
              label={t("connectedAgents.closeout.localTime", "Local time")}
              value={localTime}
              onChange={(event) => setLocalTime(event.target.value)}
              disabled={save.isPending}
              className="font-mono tabular-nums"
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!dirty || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime)}
            aria-label={t("connectedAgents.closeout.saveAria", "Save closeout")}
          >
            {t("connectedAgents.closeout.save", "Save")}
          </Button>
        </div>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-micro text-text-mute">
        <span>{routine.timezone}</span>
        <span>
          {t(
            "connectedAgents.closeout.lastReview",
            "Last review: {{time}}"
          ).replace("{{time}}", lastReview)}
        </span>
      </div>
    </div>
  );
}

export function ConnectedAgentsSection() {
  const { t } = useDictionary("settings");
  const currentUser = useAuthStore((s) => s.currentUser);
  const userId = currentUser?.id ?? "";
  const queryClient = useQueryClient();
  const [pendingGrantId, setPendingGrantId] = useState<string | null>(null);

  const { data: grants = [], isLoading } = useQuery({
    queryKey: GRANTS_QUERY_KEY,
    queryFn: async () => {
      const response = await authedFetch(GRANTS_ENDPOINT);
      if (!response.ok) throw new Error("grants_unavailable");
      return parseGrants(await response.json());
    },
    enabled: userId !== "",
    staleTime: 5 * 60 * 1000,
  });

  const { data: routines = [] } = useQuery({
    queryKey: ROUTINES_QUERY_KEY,
    queryFn: async () => {
      const response = await authedFetch(ROUTINES_ENDPOINT);
      if (!response.ok) throw new Error("routines_unavailable");
      return parseRoutines(await response.json());
    },
    enabled: userId !== "",
    staleTime: 5 * 60 * 1000,
  });

  const revoke = useMutation({
    mutationFn: async (grantId: string) => {
      const response = await authedFetch(GRANTS_ENDPOINT, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grantId }),
      });
      if (!response.ok) throw new Error("revoke_failed");
      const body = (await response.json()) as { revoked?: unknown };
      if (body.revoked !== true) throw new Error("revoke_failed");
    },
    onSettled: async () => {
      setPendingGrantId(null);
      // Refetch rather than splice: the server list is the only authority on
      // which grants are still live.
      await queryClient.invalidateQueries({ queryKey: GRANTS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ROUTINES_QUERY_KEY });
    },
    onError: () => {
      toast.error(
        t("connectedAgents.revokeFailed", "// ERROR — REVOKE FAILED")
      );
    },
  });

  const handleRevoke = useCallback(
    (grantId: string) => {
      if (pendingGrantId !== null) return;
      setPendingGrantId(grantId);
      revoke.mutate(grantId);
    },
    [pendingGrantId, revoke]
  );

  const rows = useMemo(
    () =>
      grants.map((grant) => ({
        ...grant,
        connected: formatTimeAgo(grant.createdAt, t),
        lastUsed: formatTimeAgo(grant.lastUsedAt, t),
        scopeText: connectedAgentScopeLine(grant.scopes, {
          "ops.operations.prepare": t(
            "connectedAgents.scopes.operationsPrepare",
            "Prepare an OPS day closeout for your approval"
          ),
        }),
        routine: routines.find((routine) => routine.grantId === grant.grantId),
      })),
    [grants, routines, t]
  );

  return (
    <Card>
      <CardHeader>
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {t("connectedAgents.title", "Connected agents")}
        </span>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {isLoading ? (
          <div className="flex items-center gap-[6px] py-1">
            <Loader2 className="h-[16px] w-[16px] animate-spin text-text-mute" />
            <span className="font-mohave text-body-sm text-text-mute">
              {t("connectedAgents.loading", "Loading…")}
            </span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-start gap-1 py-1">
            <span className="font-mono text-data-lg tabular-nums text-text-2">
              —
            </span>
            <span className="font-mono text-micro tracking-[0.06em] text-text-3">
              {t("connectedAgents.empty", "[no external agents connected]")}
            </span>
          </div>
        ) : (
          <div className="space-y-1">
            {rows.map((row) => (
              <div
                key={row.grantId}
                className="rounded border border-border bg-surface-input px-1.5 py-1"
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <span className="block truncate font-mohave text-body-sm text-text">
                      {row.clientName}
                    </span>
                    <span className="block font-mono text-micro text-text-mute">
                      {t(
                        "connectedAgents.metadata",
                        "Connected: {{connected}} · Last used: {{lastUsed}}"
                      )
                        .replace("{{connected}}", row.connected)
                        .replace("{{lastUsed}}", row.lastUsed)}
                    </span>
                    {row.scopeText !== "" && (
                      <span className="mt-0.5 block font-mohave text-body-sm leading-snug text-text-3">
                        {row.scopeText}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRevoke(row.grantId)}
                    loading={pendingGrantId === row.grantId}
                    disabled={pendingGrantId !== null}
                    className="shrink-0 text-text-mute hover:text-rose"
                  >
                    {t("connectedAgents.revoke", "Revoke")}
                  </Button>
                </div>
                {row.routine && (
                  <DayCloseoutRoutineControl routine={row.routine} />
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ConnectedAgentsSection;
