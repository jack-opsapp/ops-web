"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useDictionary } from "@/i18n/client";
import { queryKeys } from "@/lib/api/query-client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { authedFetch } from "@/lib/utils/authed-fetch";
import { formatTimeAgo } from "@/lib/utils/date";
import { toast } from "@/components/ui/toast";
import { Tag, type TagProps } from "@/components/ui/tag";
import { Section } from "@/components/ops/projects/workspace/atoms/section";
import { Mono } from "@/components/ops/projects/workspace/atoms/mono";
import { Btn } from "@/components/ops/projects/workspace/atoms/btn";

// `PortalAccessBlock` — the client dossier's "// PORTAL ACCESS" section
// (PUBLIC API P1, design §5.4). One row per customer membership on this
// client: masked email, state tag, last seen. The scan surface carries no
// verbs — confirm / revoke sit behind the row (hover or keyboard focus) and
// only for operators holding `clients.edit`. Each action is two-step so a
// stray click can neither open a customer's full history nor cut them off.
//
// The block always renders, even with nobody attached: staff learn the
// feature exists from the em dash, not from a settings page.

const EMPTY_GLYPH = "—";

type MembershipState = "active_forward_only" | "active_full" | "revoked" | "merged";

interface PortalMembership {
  readonly membershipId: string;
  readonly state: MembershipState;
  readonly evidenceKind: string;
  readonly maskedEmail: string;
  readonly lastSeenAt: string | null;
}

type PendingAction = "confirm" | "revoke";

interface Pending {
  readonly membershipId: string;
  readonly action: PendingAction;
}

const STATE_TAG: Record<MembershipState, { variant: TagProps["variant"]; key: string }> = {
  // Olive = positive: the customer sees the whole record.
  active_full: { variant: "olive", key: "portalAccess.state.full" },
  // Tan = attention: staff can grant history once they recognise the person.
  active_forward_only: { variant: "tan", key: "portalAccess.state.forwardOnly" },
  // Inert terminal states stay quiet.
  revoked: { variant: "dim", key: "portalAccess.state.revoked" },
  merged: { variant: "dim", key: "portalAccess.state.merged" },
};

function isMembershipState(value: unknown): value is MembershipState {
  return (
    value === "active_forward_only" ||
    value === "active_full" ||
    value === "revoked" ||
    value === "merged"
  );
}

function parseMemberships(payload: unknown): PortalMembership[] {
  const list =
    payload && typeof payload === "object" && "memberships" in payload
      ? (payload as { memberships?: unknown }).memberships
      : null;
  if (!Array.isArray(list)) return [];
  const memberships: PortalMembership[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (
      typeof row.membershipId !== "string" ||
      !isMembershipState(row.state) ||
      typeof row.maskedEmail !== "string"
    ) {
      continue;
    }
    memberships.push({
      membershipId: row.membershipId,
      state: row.state,
      evidenceKind: typeof row.evidenceKind === "string" ? row.evidenceKind : "",
      maskedEmail: row.maskedEmail,
      lastSeenAt: typeof row.lastSeenAt === "string" ? row.lastSeenAt : null,
    });
  }
  return memberships;
}

/** A non-2xx answer from the portal-access routes, with its status kept. */
class PortalAccessHttpError extends Error {
  readonly status: number;

  constructor(status: number, what: string) {
    super(`portal access ${what} ${status}`);
    this.name = "PortalAccessHttpError";
    this.status = status;
  }
}

// A refusal (4xx) is final for this operator; only a store hiccup (5xx or a
// network failure) is worth exactly one second attempt.
function retryUnlessRefused(failureCount: number, error: unknown): boolean {
  if (error instanceof PortalAccessHttpError && error.status < 500) return false;
  return failureCount < 1;
}

function endpoint(clientId: string, membershipId?: string, action?: PendingAction) {
  const base = `/api/clients/${clientId}/portal-access`;
  return membershipId && action ? `${base}/${membershipId}/${action}` : base;
}

function isLive(state: MembershipState) {
  return state === "active_forward_only" || state === "active_full";
}

export function PortalAccessBlock({ clientId }: { clientId: string }) {
  const { t } = useDictionary("clients");
  const canEdit = usePermissionStore((s) => s.can("clients.edit"));
  const queryClient = useQueryClient();
  const [pending, setPending] = React.useState<Pending | null>(null);

  const listKey = queryKeys.clients.portalAccess(clientId);

  const { data, isPending: isLoading, isError } = useQuery({
    queryKey: listKey,
    queryFn: async () => {
      const response = await authedFetch(endpoint(clientId));
      if (!response.ok) throw new PortalAccessHttpError(response.status, "read");
      return parseMemberships(await response.json());
    },
    retry: retryUnlessRefused,
  });

  const act = useMutation({
    mutationFn: async ({ membershipId, action }: Pending) => {
      const response = await authedFetch(endpoint(clientId, membershipId, action), {
        method: "POST",
      });
      if (!response.ok) throw new PortalAccessHttpError(response.status, action);
      return action;
    },
    retry: false,
    onSuccess: async (action) => {
      toast.success(
        t(action === "confirm" ? "portalAccess.toast.confirmed" : "portalAccess.toast.revoked")
      );
      // The listing is re-read after every change: state comes from the
      // store, never from a local guess about what the RPC did.
      await queryClient.invalidateQueries({ queryKey: listKey });
    },
    onError: () => toast.error(t("portalAccess.toast.failed")),
    onSettled: () => setPending(null),
  });

  const memberships = data ?? [];

  return (
    <Section title={t("window.section.portalAccess")}>
      {isLoading ? (
        <div
          aria-hidden
          className="my-2 h-[11px] w-1/3 rounded-bar bg-fill-neutral-dim motion-safe:animate-pulse"
        />
      ) : isError ? (
        <Mono size={11} color="mute" className="py-2">
          {`SYS :: ${t("portalAccess.unavailable")}`}
        </Mono>
      ) : memberships.length === 0 ? (
        <Mono size={11} color="mute" className="py-2">
          {EMPTY_GLYPH}
        </Mono>
      ) : (
        <ul className="divide-y divide-glass-border">
          {memberships.map((membership) => {
            const tag = STATE_TAG[membership.state];
            const live = isLive(membership.state);
            const rowPending =
              pending?.membershipId === membership.membershipId ? pending : null;
            const busy = act.isPending && act.variables?.membershipId === membership.membershipId;

            return (
              <li
                key={membership.membershipId}
                className="group flex items-center justify-between gap-2 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Mono
                    size={13}
                    color={live ? "text" : "text-3"}
                    caseSensitive
                    className="truncate tracking-normal"
                  >
                    {membership.maskedEmail}
                  </Mono>
                  <Tag variant={tag.variant}>{t(tag.key)}</Tag>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {canEdit && live && rowPending ? (
                    <div className="flex items-center gap-1.5">
                      <Mono size={11} color={rowPending.action === "revoke" ? "rose" : "text-3"}>
                        {t(
                          rowPending.action === "confirm"
                            ? "portalAccess.confirm.note"
                            : "portalAccess.revoke.note"
                        )}
                      </Mono>
                      <Btn
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setPending(null)}
                      >
                        {t("footer.cancel")}
                      </Btn>
                      <Btn
                        variant={rowPending.action === "revoke" ? "destructive" : "secondary"}
                        size="sm"
                        disabled={busy}
                        onClick={() => act.mutate(rowPending)}
                      >
                        {t(
                          rowPending.action === "confirm"
                            ? "portalAccess.confirm.commit"
                            : "portalAccess.revoke.commit"
                        )}
                      </Btn>
                    </div>
                  ) : (
                    <>
                      {canEdit && live && (
                        <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 ease-smooth group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
                          {membership.state === "active_forward_only" && (
                            <Btn
                              variant="secondary"
                              size="sm"
                              disabled={busy}
                              onClick={() =>
                                setPending({
                                  membershipId: membership.membershipId,
                                  action: "confirm",
                                })
                              }
                            >
                              {t("portalAccess.action.confirm")}
                            </Btn>
                          )}
                          <Btn
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            className="text-[var(--rose)]"
                            onClick={() =>
                              setPending({
                                membershipId: membership.membershipId,
                                action: "revoke",
                              })
                            }
                          >
                            {t("portalAccess.action.revoke")}
                          </Btn>
                        </div>
                      )}
                      {/* Last seen stays pinned to the row edge so the column
                          reads straight down the list whatever a row offers. */}
                      {membership.lastSeenAt ? (
                        <Mono size={11} color="text-3" className="tabular-nums">
                          {t("portalAccess.seen", {
                            when: formatTimeAgo(new Date(membership.lastSeenAt)),
                          })}
                        </Mono>
                      ) : (
                        <Mono size={11} color="mute" className="tabular-nums">
                          {EMPTY_GLYPH}
                        </Mono>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
