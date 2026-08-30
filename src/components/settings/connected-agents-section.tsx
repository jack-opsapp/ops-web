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

import { useCallback, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { connectedAgentScopeLine } from "@/components/settings/connected-agent-scope-labels";
import { useAuthStore } from "@/lib/store/auth-store";
import { authedFetch } from "@/lib/utils/authed-fetch";

const GRANTS_ENDPOINT = "/api/mcp/oauth/grants";
const GRANTS_QUERY_KEY = ["mcpOAuthGrants"] as const;

interface GrantRow {
  readonly grantId: string;
  readonly clientName: string;
  readonly scopes: readonly string[];
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
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

/**
 * Same relative ladder as the Gmail rows above ("Just now" / "12 min ago" /
 * "3h ago" / "5d ago") so both cards read as one page. DESIGN.md §2: the
 * absent value is an em dash, never a placeholder word.
 */
function formatTimeAgo(iso: string | null): string {
  if (!iso) return "—";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "—";
  const seconds = Math.floor((Date.now() - parsed) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function ConnectedAgentsSection() {
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
    },
    onError: () => {
      toast.error("// ERROR — REVOKE FAILED");
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
        connected: formatTimeAgo(grant.createdAt),
        lastUsed: formatTimeAgo(grant.lastUsedAt),
        scopeText: connectedAgentScopeLine(grant.scopes),
      })),
    [grants]
  );

  return (
    <Card>
      <CardHeader>
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          CONNECTED AGENTS
        </span>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {isLoading ? (
          <div className="flex items-center gap-[6px] py-1">
            <Loader2 className="h-[16px] w-[16px] animate-spin text-text-mute" />
            <span className="font-mohave text-body-sm text-text-mute">
              Loading...
            </span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-start gap-1 py-1">
            <span className="font-mono text-data-lg tabular-nums text-text-2">
              —
            </span>
            <span className="font-mono text-micro tracking-[0.06em] text-text-3">
              [no external agents connected]
            </span>
          </div>
        ) : (
          <div className="space-y-1">
            {rows.map((row) => (
              <div
                key={row.grantId}
                className="flex items-start justify-between gap-[8px] rounded border border-border bg-surface-input px-1.5 py-1"
              >
                <div className="min-w-0">
                  <span className="block truncate font-mohave text-body-sm text-text">
                    {row.clientName}
                  </span>
                  <span className="block font-mono text-micro text-text-mute">
                    {`Connected: ${row.connected} · Last used: ${row.lastUsed}`}
                  </span>
                  {row.scopeText !== "" && (
                    <span className="mt-[2px] block font-mohave text-body-sm leading-snug text-text-3">
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
                  REVOKE
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ConnectedAgentsSection;
