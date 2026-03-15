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
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ops/confirm-dialog";
import { InviteModal } from "@/components/ops/invite-modal";
import {
  useTeamMembers,
  useUpdateUserRole,
  useDeactivateUser,
  useReactivateUser,
  useAddSeatedEmployee,
  useRemoveSeatedEmployee,
  useCompany,
} from "@/lib/hooks";
import { useAuthStore } from "@/lib/store/auth-store";
import { getUserFullName, getInitials, UserRole } from "@/lib/types/models";
import type { User } from "@/lib/types/models";
import { toast } from "sonner";
import { useDictionary } from "@/i18n/client";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const updateRole = useUpdateUserRole();
  const deactivateUser = useDeactivateUser();
  const reactivateUser = useReactivateUser();
  const addSeat = useAddSeatedEmployee();
  const removeSeat = useRemoveSeatedEmployee();

  function handleRoleChange(role: UserRole) {
    updateRole.mutate(
      { id: member.id, role },
      {
        onSuccess: () => toast.success(`${t("team.toast.roleUpdated")} ${role}`),
        onError: (err) => toast.error(t("team.toast.roleUpdateFailed"), { description: err.message }),
      }
    );
  }

  function handleToggleSeat() {
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
    reactivateUser.mutate(
      { id: member.id },
      {
        onSuccess: () => toast.success(`${getUserFullName(member)} ${t("team.toast.reactivated")}`),
        onError: (err) => toast.error(t("team.toast.reactivateFailed"), { description: err.message }),
      }
    );
  }

  if (isCurrentUser) return null;

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
              {/* Role section */}
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

              {/* Seat toggle */}
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

              {/* Deactivate / Reactivate */}
              {isActive ? (
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

// ─── Team Tab ─────────────────────────────────────────────────────────────────

export function TeamTab() {
  const { t } = useDictionary("settings");
  const { data: teamData, isLoading } = useTeamMembers();
  const { data: company } = useCompany();
  const currentUser = useAuthStore((s) => s.currentUser);
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
        </CardContent>
      </Card>

      {/* Active Team Members */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <CardTitle>{t("team.membersTitle")} ({activeMembers.length})</CardTitle>
            <Button
              size="sm"
              onClick={() => setInviteOpen(true)}
              className="gap-[6px]"
            >
              <Plus className="w-[14px] h-[14px]" />
              {t("team.addMember")}
            </Button>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setInviteOpen(true)}
                className="gap-[6px]"
              >
                <UserPlus className="w-[14px] h-[14px]" />
                {t("team.sendInvite")}
              </Button>
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
                      <div className="w-[32px] h-[32px] rounded-full flex items-center justify-center border-2 border-ops-accent">
                        <span className="font-mohave text-body-sm text-ops-accent">
                          {getInitials(fullName)}
                        </span>
                      </div>
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
                      <div className="w-[32px] h-[32px] rounded-full flex items-center justify-center border-2 border-border-subtle">
                        <span className="font-mohave text-body-sm text-text-disabled">
                          {getInitials(fullName)}
                        </span>
                      </div>
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
