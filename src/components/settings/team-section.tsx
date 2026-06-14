"use client";

/**
 * TeamSection — SETTINGS › TEAM › Members (WEB OVERHAUL P3-6).
 *
 * The absorbed Team surface: a parity UNION of the retired standalone /team page
 * (search, role grouping, contact quick-actions, last-active, metrics) and the
 * old settings team-tab (seats/trial, deactivate, pending invites, the RBAC
 * AssignRoleModal). Rebuilt on the shared kit — a `// CREW` InstrumentStrip over
 * a `RegisterTable` roster — so Team reads identically to Books / Clients /
 * Catalog. No capability is dropped (master plan §4).
 *
 * Two role systems are preserved verbatim (they are unreconciled in the data
 * model and must not be silently merged here): the legacy `users.role` enum
 * (the per-row Role submenu → useUpdateUserRole) AND the RBAC `user_roles` table
 * (Assign company role → AssignRoleModal, the only path that clears role_needed
 * notifications). Gating is granular-permission only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  MoreHorizontal,
  Mail,
  Phone,
  Shield,
  Armchair,
  UserCog,
  UserX,
  UserCheck,
  Trash2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { FilterChips, type FilterChipOption } from "@/components/ui/filter-chip";
import { RegisterTable, RegisterEmpty, Tag, TableMono, type RegisterTableColumn } from "@/components/ui/register-table";
import {
  InstrumentStrip,
  GlanceGrid,
  GlanceTile,
  TileHero,
  TileSub,
  GlanceTileSkeleton,
  useCountUp,
} from "@/components/ui/instrument-strip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { InviteModal } from "@/components/ops/invite-modal";
import { AssignRoleModal } from "@/components/ops/assign-role-modal";
import { UserAvatar } from "@/components/ops/user-avatar";
import {
  useTeamMembers,
  useUpdateUserRole,
  useDeactivateUser,
  useReactivateUser,
  useAddSeatedEmployee,
  useRemoveSeatedEmployee,
  useCompany,
  usePendingInvitations,
  useUpdateInvitationRole,
  useRevokeInvitation,
} from "@/lib/hooks";
import { useRoles } from "@/lib/hooks/use-roles";
import { useAuthStore } from "@/lib/store/auth-store";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { getUserFullName, UserRole } from "@/lib/types/models";
import type { User } from "@/lib/types/models";
import { getSubscriptionInfo } from "@/lib/subscription";
import { trackScreenView } from "@/lib/analytics/analytics";
import { useDictionary, useLocale } from "@/i18n/client";
import { getDateLocale } from "@/i18n/date-utils";
import { toast } from "sonner";

// ── Role helpers ───────────────────────────────────────────────────────────────

const LEGACY_ROLES: { id: UserRole; labelKey: string }[] = [
  { id: UserRole.Admin, labelKey: "team.roleAdmin" },
  { id: UserRole.Owner, labelKey: "team.roleOwner" },
  { id: UserRole.Office, labelKey: "team.roleOffice" },
  { id: UserRole.Operator, labelKey: "team.roleOperator" },
  { id: UserRole.Crew, labelKey: "team.roleCrew" },
];

const ROLE_LABEL_KEY: Record<string, string> = {
  [UserRole.Admin]: "team.roleAdmin",
  [UserRole.Owner]: "team.roleOwner",
  [UserRole.Office]: "team.roleOffice",
  [UserRole.Operator]: "team.roleOperator",
  [UserRole.Crew]: "team.roleCrew",
  [UserRole.Unassigned]: "team.roleUnassigned",
};

type RoleFilter = "all" | "admins" | "office" | "operators" | "crew" | "unassigned";

function roleGroup(role: User["role"]): Exclude<RoleFilter, "all"> {
  switch (role) {
    case UserRole.Admin:
    case UserRole.Owner:
      return "admins";
    case UserRole.Office:
      return "office";
    case UserRole.Operator:
      return "operators";
    case UserRole.Crew:
      return "crew";
    default:
      return "unassigned";
  }
}

// ── Per-member actions kebab ─────────────────────────────────────────────────

function MemberActionsMenu({
  member,
  isSeated,
  seatsFull,
  onAssignRole,
}: {
  member: User;
  isSeated: boolean;
  seatsFull: boolean;
  onAssignRole: (memberId: string) => void;
}) {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const canManage = can("team.manage");
  const canAssignRoles = can("team.assign_roles");
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const updateRole = useUpdateUserRole();
  const deactivateUser = useDeactivateUser();
  const reactivateUser = useReactivateUser();
  const addSeat = useAddSeatedEmployee();
  const removeSeat = useRemoveSeatedEmployee();

  const isActive = member.isActive !== false;
  if (!canManage && !canAssignRoles) return null;

  function handleRoleChange(role: UserRole) {
    if (!canAssignRoles) return;
    updateRole.mutate(
      { id: member.id, role },
      {
        onSuccess: () => toast.success(`${t("team.toast.roleUpdated")} ${role}`),
        onError: (err) => toast.error(t("team.toast.roleUpdateFailed"), { description: err.message }),
      },
    );
  }

  function handleToggleSeat() {
    if (!canManage) return;
    if (isSeated) {
      removeSeat.mutate(member.id, {
        onSuccess: () => toast.success(t("team.toast.seatRemoved")),
        onError: (err) => toast.error(t("team.toast.seatRemoveFailed"), { description: err.message }),
      });
    } else {
      if (seatsFull) {
        toast.error(t("team.toast.noSeats"), { description: t("team.toast.upgradeSeats") });
        return;
      }
      addSeat.mutate(member.id, {
        onSuccess: () => toast.success(t("team.toast.seatAssigned")),
        onError: (err) => toast.error(t("team.toast.seatAssignFailed"), { description: err.message }),
      });
    }
  }

  function handleDeactivate() {
    if (!canManage) return;
    deactivateUser.mutate(
      { id: member.id },
      {
        onSuccess: () => {
          toast.success(`${getUserFullName(member)} ${t("team.toast.deactivated")}`);
          setConfirmDeactivate(false);
        },
        onError: (err) => toast.error(t("team.toast.deactivateFailed"), { description: err.message }),
      },
    );
  }

  function handleReactivate() {
    if (!canManage) return;
    reactivateUser.mutate(
      { id: member.id },
      {
        onSuccess: () => toast.success(`${getUserFullName(member)} ${t("team.toast.reactivated")}`),
        onError: (err) => toast.error(t("team.toast.reactivateFailed"), { description: err.message }),
      },
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t("team.actions")}
            className="rounded-[5px] p-[6px] text-text-3 transition-colors duration-150 hover:bg-surface-hover hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
          >
            <MoreHorizontal className="h-[16px] w-[16px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canAssignRoles && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <UserCog className="h-[14px] w-[14px] text-text-3" />
                  {t("team.changeRole")}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {LEGACY_ROLES.map((role) => (
                    <DropdownMenuItem
                      key={role.id}
                      onSelect={() => handleRoleChange(role.id)}
                      className={cn(member.role === role.id && "bg-surface-active text-text")}
                    >
                      {t(role.labelKey)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={() => onAssignRole(member.id)}>
                <Shield className="h-[14px] w-[14px] text-text-3" />
                {t("team.assignCompanyRole")}
              </DropdownMenuItem>
            </>
          )}
          {canManage && (
            <>
              {canAssignRoles && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={handleToggleSeat}>
                <Armchair className="h-[14px] w-[14px] text-text-3" />
                {isSeated ? t("team.removeSeat") : t("team.assignSeat")}
              </DropdownMenuItem>
              {isActive ? (
                <DropdownMenuItem
                  onSelect={() => setConfirmDeactivate(true)}
                  className="text-rose focus:text-rose"
                >
                  <UserX className="h-[14px] w-[14px]" />
                  {t("team.deactivate")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={handleReactivate} className="text-olive focus:text-olive">
                  <UserCheck className="h-[14px] w-[14px]" />
                  {t("team.reactivate")}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmDeactivate}
        onOpenChange={setConfirmDeactivate}
        title={`${t("team.deactivateConfirmTitle")} ${getUserFullName(member)}?`}
        description={t("team.deactivateConfirmDesc")}
        confirmLabel={t("team.deactivate")}
        variant="destructive"
        onConfirm={handleDeactivate}
        loading={deactivateUser.isPending}
      />
    </>
  );
}

// ── Pending invites ──────────────────────────────────────────────────────────

interface PendingInvite {
  id: string;
  email?: string | null;
  phone?: string | null;
  roleId?: string | null;
  roleName?: string | null;
  createdAt: string;
  expiresAt: string;
}

function PendingInvitesSection() {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const canAssignRoles = can("team.assign_roles");
  const canManage = can("team.manage");
  const { data: invitations, isLoading } = usePendingInvitations();
  const { data: roles } = useRoles();
  const updateRole = useUpdateInvitationRole();
  const revokeInvitation = useRevokeInvitation();
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  const now = Date.now();
  const active = useMemo(
    () => ((invitations ?? []) as PendingInvite[]).filter((inv) => new Date(inv.expiresAt).getTime() > now),
    [invitations, now],
  );
  const assignableRoles = (roles ?? []).filter((r) => r.name.toLowerCase() !== "unassigned");

  function rel(dateStr: string, future: boolean): string {
    const d = new Date(dateStr).getTime();
    const days = future
      ? Math.ceil((d - now) / 86400000)
      : Math.floor((now - d) / 86400000);
    if (future) {
      if (days <= 0) return t("team.never");
      if (days <= 7) return `${days}d`;
      return `${Math.ceil(days / 7)}w`;
    }
    if (days === 0) return t("team.justNow");
    if (days === 1) return t("team.yesterday");
    if (days <= 7) return `${days}${t("team.daysAgo")}`;
    return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function handleRoleChange(invitationId: string, roleId: string | null) {
    if (!canAssignRoles) return;
    updateRole.mutate(
      { invitationId, roleId },
      {
        onSuccess: () => toast.success(t("team.toast.roleAssigned")),
        onError: (err) => toast.error(t("team.toast.roleAssignFailed"), { description: err.message }),
      },
    );
  }

  function handleRevoke(id: string) {
    if (!canManage) return;
    revokeInvitation.mutate(id, {
      onSuccess: () => {
        toast.success(t("team.toast.inviteRevoked"));
        setConfirmRevoke(null);
      },
      onError: (err) => toast.error(t("team.toast.inviteRevokeFailed"), { description: err.message }),
    });
  }

  if (!isLoading && active.length === 0) return null;

  const columns: RegisterTableColumn<PendingInvite>[] = [
    {
      id: "recipient",
      header: t("team.colRecipient"),
      cell: (inv) => (
        <span className="flex items-center gap-1.5">
          {inv.email ? (
            <Mail className="h-[14px] w-[14px] shrink-0 text-text-3" />
          ) : (
            <Phone className="h-[14px] w-[14px] shrink-0 text-text-3" />
          )}
          <span className="font-mono text-data-sm text-text">{inv.email ?? inv.phone ?? "—"}</span>
        </span>
      ),
    },
    {
      id: "role",
      header: t("team.colRole"),
      cell: (inv) => <Tag variant="neutral">{inv.roleName ?? t("team.pendingInvitesNoRole")}</Tag>,
    },
    {
      id: "sent",
      header: t("team.colSent"),
      className: "hidden lg:table-cell",
      cell: (inv) => <TableMono>{rel(inv.createdAt, false)}</TableMono>,
    },
    {
      id: "expires",
      header: t("team.colExpires"),
      cell: (inv) => <TableMono tone="muted">{rel(inv.expiresAt, true)}</TableMono>,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (inv) =>
        canAssignRoles || canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("team.actions")}
                className="rounded-[5px] p-[6px] text-text-3 transition-colors duration-150 hover:bg-surface-hover hover:text-text-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ops-accent"
              >
                <MoreHorizontal className="h-[16px] w-[16px]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canAssignRoles && (
                <>
                  <DropdownMenuLabel>{t("team.pendingInvitesChangeRole")}</DropdownMenuLabel>
                  <DropdownMenuItem
                    onSelect={() => handleRoleChange(inv.id, null)}
                    className={cn(!inv.roleId && "bg-surface-active text-text")}
                  >
                    {t("team.pendingInvitesNoRole")}
                  </DropdownMenuItem>
                  {assignableRoles.map((role) => (
                    <DropdownMenuItem
                      key={role.id}
                      onSelect={() => handleRoleChange(inv.id, role.id)}
                      className={cn(inv.roleId === role.id && "bg-surface-active text-text")}
                    >
                      {role.name}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {canManage && (
                <>
                  {canAssignRoles && <DropdownMenuSeparator />}
                  <DropdownMenuItem onSelect={() => setConfirmRevoke(inv.id)} className="text-rose focus:text-rose">
                    <Trash2 className="h-[14px] w-[14px]" />
                    {t("team.pendingInvitesRevoke")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ];

  return (
    <section aria-label={t("team.pendingInvites")}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
          <span className="text-text-mute">{"// "}</span>
          {t("team.pendingInvites")}
        </span>
        <Tag variant="tan">{active.length}</Tag>
      </div>
      {isLoading ? (
        <div className="glass-surface flex items-center justify-center py-6">
          <Loader2 className="h-[18px] w-[18px] animate-spin text-text-2 motion-reduce:animate-none" />
        </div>
      ) : (
        <RegisterTable
          ariaLabel={t("team.pendingInvites")}
          columns={columns}
          rows={active}
          getRowId={(inv) => inv.id}
          minWidth={560}
        />
      )}
      <ConfirmDialog
        open={!!confirmRevoke}
        onOpenChange={(o) => { if (!o) setConfirmRevoke(null); }}
        title={t("team.pendingInvitesRevokeTitle")}
        description={t("team.pendingInvitesRevokeDesc")}
        confirmLabel={t("team.pendingInvitesRevoke")}
        variant="destructive"
        onConfirm={() => confirmRevoke && handleRevoke(confirmRevoke)}
        loading={revokeInvitation.isPending}
      />
    </section>
  );
}

// ── Section ────────────────────────────────────────────────────────────────

export function TeamSection() {
  const { t } = useDictionary("settings");
  const { locale } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();

  const { data: teamData, isLoading } = useTeamMembers();
  const { data: company } = useCompany();
  const { data: invitations } = usePendingInvitations();
  const currentUser = useAuthStore((s) => s.currentUser);
  const can = usePermissionStore((s) => s.can);
  const canManage = can("team.manage");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => { trackScreenView("team"); }, []);

  // Auto-open invite on ?action=invite (legacy /team?action=invite parity).
  useEffect(() => {
    if (searchParams.get("action") === "invite") setInviteOpen(true);
  }, [searchParams]);

  // Deep-link RBAC assignment: ?assignRole=<memberId>.
  const assignRoleMemberId = searchParams.get("assignRole");
  const openAssignRole = useCallback(
    (memberId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("assignRole", memberId);
      router.replace(`/settings?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );
  const closeAssignRole = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("assignRole");
    const qs = params.toString();
    router.replace(qs ? `/settings?${qs}` : "/settings", { scroll: false });
  }, [router, searchParams]);

  // ── Roster ────────────────────────────────────────────────────────────────
  const members = useMemo(
    () => (teamData?.users ?? []).filter((u) => !u.deletedAt),
    [teamData],
  );
  const activeMembers = useMemo(() => members.filter((m) => m.isActive !== false), [members]);
  const deactivatedMembers = useMemo(() => members.filter((m) => m.isActive === false), [members]);

  const seatedIds = useMemo(() => company?.seatedEmployeeIds ?? [], [company]);
  const maxSeats = company?.maxSeats ?? 10;
  const seatedCount = seatedIds.length;
  const seatsFull = seatedCount >= maxSeats;

  const subscriptionInfo = getSubscriptionInfo(company ?? null);
  const isTrial = subscriptionInfo.tier === "trial";
  const trialDays = subscriptionInfo.daysRemaining;

  const pendingCount = useMemo(
    () => ((invitations ?? []) as PendingInvite[]).filter((i) => new Date(i.expiresAt).getTime() > Date.now()).length,
    [invitations],
  );

  // ── Metrics (count-up) ──────────────────────────────────────────────────────
  const dataReady = !isLoading;
  const membersN = useCountUp(members.length, dataReady);
  const seatedN = useCountUp(seatedCount, dataReady);
  const activeN = useCountUp(activeMembers.length, dataReady);
  const pendingN = useCountUp(pendingCount, dataReady);

  function formatLastActive(user: User): string {
    const raw = user.lastSyncedAt;
    const date = raw ? new Date(raw as string | Date) : null;
    if (!date || isNaN(date.getTime()) || date.getTime() === 0) return t("team.never");
    const diffH = Math.floor((Date.now() - date.getTime()) / 3600000);
    const diffD = Math.floor(diffH / 24);
    if (diffH < 1) return t("team.justNow");
    if (diffH < 24) return `${diffH}${t("team.hoursAgo")}`;
    if (diffD === 1) return t("team.yesterday");
    if (diffD < 7) return `${diffD}${t("team.daysAgo")}`;
    return date.toLocaleDateString(getDateLocale(locale), { month: "short", day: "numeric" });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeMembers.filter((m) => {
      if (roleFilter !== "all" && roleGroup(m.role) !== roleFilter) return false;
      if (!q) return true;
      const label = t(ROLE_LABEL_KEY[m.role] ?? "team.roleCrew").toLowerCase();
      return (
        getUserFullName(m).toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q) ||
        (m.phone ?? "").includes(q) ||
        label.includes(q)
      );
    });
  }, [activeMembers, roleFilter, search, t]);

  const isFiltering = !!search.trim() || roleFilter !== "all";

  const roleFilterOptions: FilterChipOption<RoleFilter>[] = [
    { value: "all", label: t("team.groupAll") },
    { value: "admins", label: t("team.groupAdmins") },
    { value: "office", label: t("team.groupOffice") },
    { value: "operators", label: t("team.groupOperators") },
    { value: "crew", label: t("team.groupCrew") },
    { value: "unassigned", label: t("team.groupUnassigned") },
  ];

  function MemberCell({ m }: { m: User }) {
    const isSelf = m.id === currentUser?.id;
    return (
      <span className="flex items-center gap-1.5">
        <UserAvatar name={getUserFullName(m)} imageUrl={m.profileImageURL} size="sm" />
        <span className="truncate font-mohave text-body-sm text-text">{getUserFullName(m)}</span>
        {isSelf && (
          <span className="font-mono text-micro uppercase tracking-[0.14em] text-text-mute">[{t("team.you")}]</span>
        )}
      </span>
    );
  }

  const columns: RegisterTableColumn<User>[] = [
    { id: "member", header: t("team.colMember"), cell: (m) => <MemberCell m={m} /> },
    {
      id: "role",
      header: t("team.colRole"),
      cell: (m) => (
        <Tag variant="neutral">
          {m.isCompanyAdmin && <Shield className="h-[11px] w-[11px]" />}
          {m.isCompanyAdmin ? t("team.roleAdmin") : t(ROLE_LABEL_KEY[m.role] ?? "team.roleCrew")}
        </Tag>
      ),
    },
    {
      id: "contact",
      header: t("team.colContact"),
      className: "hidden xl:table-cell",
      cell: (m) => (
        <span className="flex items-center gap-2">
          {m.email && (
            <a
              href={`mailto:${m.email}`}
              className="truncate font-mono text-data-sm text-text-3 transition-colors hover:text-text"
            >
              {m.email}
            </a>
          )}
          {m.phone && (
            <a
              href={`tel:${m.phone}`}
              className="font-mono text-data-sm text-text-3 transition-colors hover:text-text"
            >
              {m.phone}
            </a>
          )}
          {!m.email && !m.phone && <span className="font-mono text-data-sm text-text-mute">—</span>}
        </span>
      ),
    },
    {
      id: "seat",
      header: t("team.colSeat"),
      cell: (m) =>
        seatedIds.includes(m.id) ? (
          <Tag variant="olive">{t("team.seated")}</Tag>
        ) : (
          <Tag variant="dim">{t("team.unseated")}</Tag>
        ),
    },
    {
      id: "active",
      header: t("team.colActive"),
      className: "hidden lg:table-cell",
      cell: (m) => <TableMono>{formatLastActive(m)}</TableMono>,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (m) =>
        m.id === currentUser?.id ? null : (
          <MemberActionsMenu
            member={m}
            isSeated={seatedIds.includes(m.id)}
            seatsFull={seatsFull}
            onAssignRole={openAssignRole}
          />
        ),
    },
  ];

  const deactivatedColumns: RegisterTableColumn<User>[] = [
    { id: "member", header: t("team.colMember"), cell: (m) => <MemberCell m={m} /> },
    {
      id: "role",
      header: t("team.colRole"),
      cell: (m) => <Tag variant="dim">{t(ROLE_LABEL_KEY[m.role] ?? "team.roleCrew")}</Tag>,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (m) => (
        <MemberActionsMenu
          member={m}
          isSeated={seatedIds.includes(m.id)}
          seatsFull={seatsFull}
          onAssignRole={openAssignRole}
        />
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* ── // CREW glance strip ──────────────────────────────────────────── */}
      <div ref={stripRef}>
        <InstrumentStrip label={t("team.crew")}>
          <GlanceGrid className="grid-cols-2 xl:grid-cols-4">
            {isLoading ? (
              <>
                <GlanceTileSkeleton />
                <GlanceTileSkeleton />
                <GlanceTileSkeleton />
                <GlanceTileSkeleton />
              </>
            ) : (
              <>
                <GlanceTile label={t("team.members")}>
                  <TileHero>{membersN}</TileHero>
                </GlanceTile>
                <GlanceTile label={t("team.seats")}>
                  <TileHero tone={seatsFull ? "rose" : undefined}>
                    {seatedN}
                    <span className="text-text-3">/{maxSeats}</span>
                  </TileHero>
                  <div className="mt-2 h-[3px] overflow-hidden rounded-[2px] bg-fill-neutral-dim">
                    <div
                      className={cn("h-full rounded-[2px] transition-[width] duration-200 ease-smooth", seatsFull ? "bg-rose" : "bg-fill-neutral")}
                      style={{ width: `${Math.min(100, Math.round((seatedCount / maxSeats) * 100))}%` }}
                    />
                  </div>
                  <TileSub>
                    {isTrial && trialDays !== undefined ? (
                      <button
                        type="button"
                        onClick={() => router.replace("/settings?section=billing", { scroll: false })}
                        className="text-tan transition-colors hover:text-text"
                      >
                        {t("team.trialEndsIn")} {trialDays} {trialDays === 1 ? t("team.trialDay") : t("team.trialDays")} · {t("team.upgradePlan")}
                      </button>
                    ) : seatsFull ? (
                      <span className="text-rose">{t("team.allSeatsUsed")}</span>
                    ) : (
                      `${maxSeats - seatedCount} ${t("team.seatsOpen")}`
                    )}
                  </TileSub>
                </GlanceTile>
                <GlanceTile label={t("team.active")}>
                  <TileHero tone="olive">{activeN}</TileHero>
                </GlanceTile>
                <GlanceTile label={t("team.pending")}>
                  <TileHero tone={pendingCount > 0 ? undefined : undefined}>{pendingN}</TileHero>
                </GlanceTile>
              </>
            )}
          </GlanceGrid>
        </InstrumentStrip>
      </div>

      {/* ── Workbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("team.searchPlaceholder")}
          wrapperClassName="min-w-[200px] flex-1 max-w-[320px]"
        />
        <FilterChips options={roleFilterOptions} value={roleFilter} onChange={setRoleFilter} />
        {canManage && (
          <Button variant="primary" size="sm" className="ml-auto gap-1.5" onClick={() => setInviteOpen(true)}>
            <Plus className="h-[14px] w-[14px]" />
            {t("team.addMember")}
          </Button>
        )}
      </div>

      {/* ── Active roster ────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="glass-surface flex items-center justify-center py-8">
          <Loader2 className="h-[20px] w-[20px] animate-spin text-text-2 motion-reduce:animate-none" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-surface">
          <RegisterEmpty
            noun={isFiltering ? t("team.matches") : t("team.members")}
            value={String(filtered.length)}
          />
        </div>
      ) : (
        <RegisterTable
          ariaLabel={t("team.membersTitle")}
          columns={columns}
          rows={filtered}
          getRowId={(m) => m.id}
        />
      )}

      {/* ── Pending invites ──────────────────────────────────────────────── */}
      <PendingInvitesSection />

      {/* ── Deactivated ──────────────────────────────────────────────────── */}
      {deactivatedMembers.length > 0 && (
        <section aria-label={t("team.deactivatedTitle")}>
          <div className="mb-1.5">
            <span className="font-mono text-micro uppercase tracking-[0.16em] text-text-3">
              <span className="text-text-mute">{"// "}</span>
              {t("team.deactivatedTitle")} <span className="text-text-mute">({deactivatedMembers.length})</span>
            </span>
          </div>
          <div className="opacity-60">
            <RegisterTable
              ariaLabel={t("team.deactivatedTitle")}
              columns={deactivatedColumns}
              rows={deactivatedMembers}
              getRowId={(m) => m.id}
              minWidth={480}
            />
          </div>
        </section>
      )}

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      <InviteModal open={inviteOpen} onOpenChange={setInviteOpen} />
      {assignRoleMemberId && (
        <AssignRoleModal
          memberId={assignRoleMemberId}
          open={true}
          onClose={closeAssignRole}
          onManageSeats={() => stripRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
      )}
    </div>
  );
}
