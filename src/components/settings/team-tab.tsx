"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  UserPlus,
  Shield,
  MoreHorizontal,
  UserX,
  UserCheck,
  Armchair,
  Loader2,
  Plus,
  Info,
  Clock,
  Trash2,
  ChevronDown,
  Mail,
  Phone,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { InviteModal } from "@/components/ops/invite-modal";
import { UserAvatar } from "@/components/ops/user-avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { getUserFullName, getInitials, UserRole } from "@/lib/types/models";
import type { User } from "@/lib/types/models";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";
import { usePermissionStore } from "@/lib/store/permissions-store";
import { getSubscriptionInfo } from "@/lib/subscription";
import Link from "next/link";

const ROLES: { id: UserRole; labelKey: string }[] = [
  { id: UserRole.Admin, labelKey: "team.roleAdmin" },
  { id: UserRole.Owner, labelKey: "team.roleOwner" },
  { id: UserRole.Operator, labelKey: "team.roleOperator" },
  { id: UserRole.Crew, labelKey: "team.roleCrew" },
];

// ─── Member Actions Menu ──────────────────────────────────────────────────────

function MemberActions({
  member,
  isCurrentUser,
  isSeated,
  seatsFull,
}: {
  member: User;
  isCurrentUser: boolean;
  isSeated: boolean;
  seatsFull: boolean;
}) {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const canManage = can("team.manage");
  const canAssignRoles = can("team.assign_roles");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const updateRole = useUpdateUserRole();
  const deactivateUser = useDeactivateUser();
  const reactivateUser = useReactivateUser();
  const addSeat = useAddSeatedEmployee();
  const removeSeat = useRemoveSeatedEmployee();

  function handleRoleChange(role: UserRole) {
    if (!canAssignRoles) return;
    updateRole.mutate(
      { id: member.id, role },
      {
        onSuccess: () => toast.success(`${t("team.toast.roleUpdated")} ${role}`),
        onError: (err) => toast.error(t("team.toast.roleUpdateFailed"), { description: err.message }),
      }
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
      }
    );
  }

  function handleReactivate() {
    if (!canManage) return;
    reactivateUser.mutate(
      { id: member.id },
      {
        onSuccess: () => toast.success(`${getUserFullName(member)} ${t("team.toast.reactivated")}`),
        onError: (err) => toast.error(t("team.toast.reactivateFailed"), { description: err.message }),
      }
    );
  }

  if (isCurrentUser) return null;
  if (!canManage && !canAssignRoles) return null;

  const isActive = member.isActive !== false;

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="p-[6px] rounded hover:bg-background-elevated transition-colors"
        >
          <MoreHorizontal className="w-[16px] h-[16px] text-text-tertiary" />
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full mt-[4px] z-50 min-w-[180px] bg-background-card border border-border rounded-lg shadow-lg overflow-hidden">
              {/* Role section — only visible with team.assign_roles */}
              {canAssignRoles && (
                <div className="px-1.5 py-[6px] border-b border-[rgba(255,255,255,0.04)]">
                  <p className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider mb-[4px]">{t("team.role")}</p>
                  {ROLES.map((role) => (
                    <button
                      key={role.id}
                      onClick={() => {
                        handleRoleChange(role.id);
                        setMenuOpen(false);
                      }}
                      className={cn(
                        "w-full text-left px-1 py-[4px] rounded font-mohave text-body-sm transition-colors",
                        member.role === role.id
                          ? "text-ops-accent bg-ops-accent-muted"
                          : "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
                      )}
                    >
                      {t(role.labelKey)}
                    </button>
                  ))}
                </div>
              )}

              {/* Seat toggle — only visible with team.manage */}
              {canManage && (
                <button
                  onClick={() => {
                    handleToggleSeat();
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-1 px-1.5 py-[8px] font-mohave text-body-sm text-text-secondary hover:text-text-primary hover:bg-background-elevated transition-colors border-b border-[rgba(255,255,255,0.04)]"
                >
                  <Armchair className="w-[14px] h-[14px]" />
                  {isSeated ? t("team.removeSeat") : t("team.assignSeat")}
                </button>
              )}

              {/* Deactivate / Reactivate — only visible with team.manage */}
              {canManage && (
                isActive ? (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDeactivate(true);
                    }}
                    className="w-full flex items-center gap-1 px-1.5 py-[8px] font-mohave text-body-sm text-ops-error hover:bg-background-elevated transition-colors"
                  >
                    <UserX className="w-[14px] h-[14px]" />
                    {t("team.deactivate")}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      handleReactivate();
                      setMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-1 px-1.5 py-[8px] font-mohave text-body-sm text-status-success hover:bg-background-elevated transition-colors"
                  >
                    <UserCheck className="w-[14px] h-[14px]" />
                    {t("team.reactivate")}
                  </button>
                )
              )}
            </div>
          </>
        )}
      </div>

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

// ─── Pending Invites Card ────────────────────────────────────────────────────

function PendingInvitesCard() {
  const { t } = useDictionary("settings");
  const can = usePermissionStore((s) => s.can);
  const { data: invitations, isLoading } = usePendingInvitations();
  const { data: roles } = useRoles();
  const updateRole = useUpdateInvitationRole();
  const revokeInvitation = useRevokeInvitation();

  const [roleMenuOpen, setRoleMenuOpen] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  // Filter out expired invitations client-side
  const now = new Date();
  const activeInvitations = (invitations ?? []).filter(
    (inv) => new Date(inv.expiresAt) > now
  );

  function handleRoleChange(invitationId: string, roleId: string | null) {
    if (!can("team.assign_roles")) return;
    updateRole.mutate(
      { invitationId, roleId },
      {
        onSuccess: () => {
          toast.success(t("team.toast.roleAssigned"));
          setRoleMenuOpen(null);
        },
        onError: (err) => toast.error(t("team.toast.roleAssignFailed"), { description: err.message }),
      }
    );
  }

  function handleRevoke(invitationId: string) {
    if (!can("team.manage")) return;
    revokeInvitation.mutate(invitationId, {
      onSuccess: () => {
        toast.success(t("team.toast.inviteRevoked"));
        setConfirmRevoke(null);
      },
      onError: (err) => toast.error(t("team.toast.inviteRevokeFailed"), { description: err.message }),
    });
  }

  function formatRelativeDate(dateStr: string): string {
    const date = new Date(dateStr);
    const diffMs = date.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return "today";
    if (diffDays === 1) return "tomorrow";
    if (diffDays <= 7) return `${diffDays}d`;
    return `${Math.ceil(diffDays / 7)}w`;
  }

  function formatSentDate(dateStr: string): string {
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "today";
    if (diffDays === 1) return "yesterday";
    if (diffDays <= 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  // Filter roles to exclude "Unassigned" from the dropdown
  const assignableRoles = (roles ?? []).filter(
    (r) => r.name.toLowerCase() !== "unassigned"
  );

  if (!isLoading && activeInvitations.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <Clock className="w-[14px] h-[14px] text-text-tertiary" />
          <CardTitle>{t("team.pendingInvites")} ({activeInvitations.length})</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
          </div>
        ) : (
          <div className="space-y-0">
            {activeInvitations.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0"
              >
                {/* Left: recipient + metadata */}
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className="w-[32px] h-[32px] rounded-full bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] flex items-center justify-center shrink-0">
                    {inv.email ? (
                      <Mail className="w-[14px] h-[14px] text-text-disabled" />
                    ) : (
                      <Phone className="w-[14px] h-[14px] text-text-disabled" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono text-[12px] text-text-primary truncate">
                      {inv.email ?? inv.phone ?? "—"}
                    </p>
                    <div className="flex items-center gap-[6px]">
                      <span className="font-kosugi text-[9px] text-text-disabled">
                        {t("team.pendingInvitesSent")} {formatSentDate(inv.createdAt)}
                      </span>
                      <span className="font-kosugi text-[9px] text-text-disabled">
                        {t("team.pendingInvitesExpires")} {formatRelativeDate(inv.expiresAt)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right: role selector + revoke */}
                <div className="flex items-center gap-[6px] shrink-0">
                  {/* Role dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setRoleMenuOpen(roleMenuOpen === inv.id ? null : inv.id)}
                      className={cn(
                        "flex items-center gap-[4px] px-[6px] py-[3px] rounded-sm text-left transition-colors",
                        "border border-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.12)] hover:bg-background-elevated",
                        inv.roleName ? "text-text-secondary" : "text-text-disabled"
                      )}
                    >
                      <span className="font-kosugi text-[10px] uppercase tracking-wider">
                        {inv.roleName ?? t("team.pendingInvitesNoRole")}
                      </span>
                      <ChevronDown className="w-[10px] h-[10px]" />
                    </button>

                    {roleMenuOpen === inv.id && (
                      <>
                        <div className="fixed inset-0 z-30" onClick={() => setRoleMenuOpen(null)} />
                        <div className="absolute right-0 top-full mt-[4px] z-50 min-w-[160px] bg-background-card border border-border rounded-lg shadow-lg overflow-hidden">
                          <div className="px-1.5 py-[6px]">
                            <p className="font-kosugi text-[10px] text-text-disabled uppercase tracking-wider mb-[4px]">
                              {t("team.pendingInvitesChangeRole")}
                            </p>
                            {/* None / unassigned option */}
                            <button
                              onClick={() => handleRoleChange(inv.id, null)}
                              className={cn(
                                "w-full text-left px-1 py-[4px] rounded font-mohave text-body-sm transition-colors",
                                !inv.roleId
                                  ? "text-ops-accent bg-ops-accent-muted"
                                  : "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
                              )}
                            >
                              {t("team.pendingInvitesNoRole")}
                            </button>
                            {assignableRoles.map((role) => (
                              <button
                                key={role.id}
                                onClick={() => handleRoleChange(inv.id, role.id)}
                                className={cn(
                                  "w-full text-left px-1 py-[4px] rounded font-mohave text-body-sm transition-colors",
                                  inv.roleId === role.id
                                    ? "text-ops-accent bg-ops-accent-muted"
                                    : "text-text-secondary hover:text-text-primary hover:bg-background-elevated"
                                )}
                              >
                                {role.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Revoke button */}
                  <button
                    onClick={() => setConfirmRevoke(inv.id)}
                    className="p-[6px] rounded hover:bg-background-elevated transition-colors group"
                  >
                    <Trash2 className="w-[14px] h-[14px] text-text-disabled group-hover:text-ops-error transition-colors" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Revoke confirmation dialog */}
        <ConfirmDialog
          open={!!confirmRevoke}
          onOpenChange={(open) => { if (!open) setConfirmRevoke(null); }}
          title={t("team.pendingInvitesRevokeTitle")}
          description={t("team.pendingInvitesRevokeDesc")}
          confirmLabel={t("team.pendingInvitesRevoke")}
          variant="destructive"
          onConfirm={() => confirmRevoke && handleRevoke(confirmRevoke)}
          loading={revokeInvitation.isPending}
        />
      </CardContent>
    </Card>
  );
}

// ─── Team Tab ─────────────────────────────────────────────────────────────────

export function TeamTab() {
  const { t } = useDictionary("settings");
  const { data: teamData, isLoading } = useTeamMembers();
  const { data: company } = useCompany();
  const currentUser = useAuthStore((s) => s.currentUser);
  const can = usePermissionStore((s) => s.can);
  const canManage = can("team.manage");
  const members = teamData?.users ?? [];

  const [inviteOpen, setInviteOpen] = useState(false);
  const searchParams = useSearchParams();

  // Auto-open invite modal when navigated with ?action=invite
  useEffect(() => {
    if (searchParams.get("action") === "invite") {
      setInviteOpen(true);
    }
  }, [searchParams]);

  const seatedIds = company?.seatedEmployeeIds ?? [];
  const maxSeats = company?.maxSeats ?? 10;
  const seatedCount = seatedIds.length;
  const seatsFull = seatedCount >= maxSeats;

  const subscriptionInfo = getSubscriptionInfo(company ?? null);
  const isTrial = subscriptionInfo.tier === "trial";
  const trialDaysRemaining = subscriptionInfo.daysRemaining;

  // Separate active and deactivated members
  const activeMembers = members.filter((m) => m.isActive !== false);
  const deactivatedMembers = members.filter((m) => m.isActive === false);

  return (
    <div className="space-y-3">
      {/* Top section: Seat Usage */}
      <Card>
        <CardHeader>
          <CardTitle>{t("team.seatUsage")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between mb-1">
            <span className="font-mohave text-body text-text-secondary">{t("team.activeSeats")}</span>
            <span className="font-mono text-data text-text-primary">
              {seatedCount} / {maxSeats}
            </span>
          </div>
          <div className="h-[6px] bg-background-elevated rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                seatsFull ? "bg-ops-error" : "bg-ops-accent"
              )}
              style={{ width: `${Math.min(100, Math.round((seatedCount / maxSeats) * 100))}%` }}
            />
          </div>
          {seatsFull && (
            <p className="font-kosugi text-[11px] text-ops-error mt-[6px]">
              {t("team.allSeatsUsed")}
            </p>
          )}
          {isTrial && trialDaysRemaining !== undefined && (
            <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-[rgba(255,255,255,0.04)]">
              <div className="flex items-center gap-[6px]">
                <span className="font-mohave text-body-sm text-ops-amber">
                  {t("team.trialEndsIn")} {trialDaysRemaining} {trialDaysRemaining === 1 ? t("team.trialDay") : t("team.trialDays")}
                </span>
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-[14px] h-[14px] text-text-tertiary cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[240px]">
                      <p className="font-kosugi text-[11px]">{t("team.trialTooltip")}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Link
                href="/settings?tab=subscription"
                className="font-mohave text-body-sm text-ops-accent hover:text-ops-accent-hover transition-colors"
              >
                {t("team.upgradePlan")}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Team Members */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle>{t("team.membersTitle")} ({activeMembers.length})</CardTitle>
            {canManage && (
              <Button
                size="sm"
                onClick={() => setInviteOpen(true)}
                className="gap-[6px]"
              >
                <Plus className="w-[14px] h-[14px]" />
                {t("team.addMember")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-[20px] h-[20px] text-ops-accent animate-spin" />
            </div>
          ) : activeMembers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-4 gap-1.5">
              <p className="font-mohave text-body-sm text-text-tertiary">
                {t("team.emptyState")}
              </p>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setInviteOpen(true)}
                  className="gap-[6px]"
                >
                  <UserPlus className="w-[14px] h-[14px]" />
                  {t("team.sendInvite")}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-0">
              {activeMembers.map((member) => {
                const fullName = getUserFullName(member);
                const isCurrentUser = member.id === currentUser?.id;
                const isSeated = seatedIds.includes(member.id);

                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0"
                  >
                    <div className="flex items-center gap-1.5">
                      <UserAvatar
                        name={fullName}
                        imageUrl={member.profileImageURL}
                        color={member.userColor ?? undefined}
                        size="sm"
                      />
                      <div>
                        <div className="flex items-center gap-[6px]">
                          <p className="font-mohave text-body text-text-primary">{fullName}</p>
                          {isCurrentUser && (
                            <span className="font-kosugi text-[9px] text-text-disabled uppercase tracking-wider">
                              {t("team.you")}
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-[10px] text-text-disabled">
                          {member.email ?? "No email"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-[6px]">
                      {isSeated && (
                        <span className="font-kosugi text-[9px] text-ops-accent bg-ops-accent-muted px-[6px] py-[2px] rounded-full">
                          {t("team.seated")}
                        </span>
                      )}
                      {member.isCompanyAdmin && (
                        <Shield className="w-[14px] h-[14px] text-ops-amber" />
                      )}
                      <span className="font-kosugi text-[10px] text-text-tertiary uppercase tracking-wider">
                        {member.isCompanyAdmin ? "Admin" : member.role || "Crew"}
                      </span>
                      <MemberActions
                        member={member}
                        isCurrentUser={isCurrentUser}
                        isSeated={isSeated}
                        seatsFull={seatsFull}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Invites */}
      <PendingInvitesCard />

      {/* Deactivated Members */}
      {deactivatedMembers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("team.deactivatedTitle")} ({deactivatedMembers.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              {deactivatedMembers.map((member) => {
                const fullName = getUserFullName(member);
                const isSeated = seatedIds.includes(member.id);

                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between py-[8px] border-b border-[rgba(255,255,255,0.04)] last:border-0 opacity-60"
                  >
                    <div className="flex items-center gap-1.5">
                      <UserAvatar
                        name={fullName}
                        imageUrl={member.profileImageURL}
                        color={member.userColor ?? undefined}
                        size="sm"
                      />
                      <div>
                        <p className="font-mohave text-body text-text-tertiary">{fullName}</p>
                        <p className="font-mono text-[10px] text-text-disabled">
                          {member.email ?? "No email"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-[6px]">
                      <span className="font-kosugi text-[9px] text-ops-error bg-ops-error-muted px-[6px] py-[2px] rounded-full">
                        Inactive
                      </span>
                      <MemberActions
                        member={member}
                        isCurrentUser={false}
                        isSeated={isSeated}
                        seatsFull={seatsFull}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invite Modal */}
      <InviteModal open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
